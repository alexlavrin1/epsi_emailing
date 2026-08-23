-- Context-aware, approval-only client-success drafting agent.
BEGIN;

ALTER TABLE client_playbook_drafts
  ADD COLUMN IF NOT EXISTS agent_status TEXT NOT NULL DEFAULT 'not_requested',
  ADD COLUMN IF NOT EXISTS agent_attempt_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS agent_claimed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS agent_generated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS agent_model TEXT,
  ADD COLUMN IF NOT EXISTS agent_response_id TEXT,
  ADD COLUMN IF NOT EXISTS agent_failure_code TEXT,
  ADD COLUMN IF NOT EXISTS agent_context_sha256 TEXT,
  ADD COLUMN IF NOT EXISTS agent_context_warnings TEXT[] NOT NULL DEFAULT '{}'::TEXT[];

ALTER TABLE client_playbook_drafts DROP CONSTRAINT IF EXISTS client_playbook_drafts_agent_status_check;
ALTER TABLE client_playbook_drafts ADD CONSTRAINT client_playbook_drafts_agent_status_check CHECK (agent_status IN ('not_requested','pending','processing','completed','failed'));
ALTER TABLE client_playbook_drafts DROP CONSTRAINT IF EXISTS client_playbook_drafts_agent_attempts_check;
ALTER TABLE client_playbook_drafts ADD CONSTRAINT client_playbook_drafts_agent_attempts_check CHECK (agent_attempt_count BETWEEN 0 AND 3);
ALTER TABLE client_playbook_drafts DROP CONSTRAINT IF EXISTS client_playbook_drafts_agent_metadata_check;
ALTER TABLE client_playbook_drafts ADD CONSTRAINT client_playbook_drafts_agent_metadata_check CHECK (
  (agent_status='processing' AND agent_claimed_at IS NOT NULL) OR
  (agent_status='completed' AND generation_mode='agent' AND agent_generated_at IS NOT NULL AND agent_model IS NOT NULL AND agent_context_sha256 ~ '^[0-9a-f]{64}$') OR
  (agent_status='failed' AND agent_failure_code IS NOT NULL) OR
  agent_status IN ('not_requested','pending')
);
ALTER TABLE client_playbook_drafts DROP CONSTRAINT IF EXISTS client_playbook_drafts_agent_warnings_check;
ALTER TABLE client_playbook_drafts ADD CONSTRAINT client_playbook_drafts_agent_warnings_check CHECK (agent_context_warnings <@ ARRAY['no_email_history','slack_history_unavailable','billing_state_uncertain','relationship_note_missing']::TEXT[]);
CREATE INDEX IF NOT EXISTS client_playbook_drafts_agent_queue_idx ON client_playbook_drafts(agent_status,created_at) WHERE status='draft';

CREATE TABLE IF NOT EXISTS client_playbook_draft_sources (
  draft_id UUID NOT NULL REFERENCES client_playbook_drafts(id) ON DELETE CASCADE,
  message_id UUID NOT NULL REFERENCES client_email_messages(id) ON DELETE RESTRICT,
  ordinal INTEGER NOT NULL CHECK (ordinal BETWEEN 1 AND 5000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (draft_id,message_id),
  UNIQUE (draft_id,ordinal)
);
ALTER TABLE client_playbook_draft_sources ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS client_playbook_draft_sources_member_read ON client_playbook_draft_sources;
CREATE POLICY client_playbook_draft_sources_member_read ON client_playbook_draft_sources FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM client_playbook_drafts draft WHERE draft.id=draft_id AND dashboard_is_org_member(draft.organization_id)));
REVOKE INSERT,UPDATE,DELETE,TRUNCATE ON client_playbook_draft_sources FROM authenticated,anon;
GRANT SELECT ON client_playbook_draft_sources TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON client_playbook_draft_sources TO service_role;

CREATE OR REPLACE FUNCTION guard_claimed_client_playbook_agent_draft() RETURNS TRIGGER LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF OLD.agent_status IN ('pending','processing') AND NEW.agent_status=OLD.agent_status AND (NEW.status IS DISTINCT FROM OLD.status OR NEW.subject IS DISTINCT FROM OLD.subject OR NEW.body IS DISTINCT FROM OLD.body) THEN RAISE EXCEPTION 'Agent draft preparation is still in progress'; END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS client_playbook_drafts_guard_agent_claim ON client_playbook_drafts;
CREATE TRIGGER client_playbook_drafts_guard_agent_claim BEFORE UPDATE ON client_playbook_drafts FOR EACH ROW EXECUTE FUNCTION guard_claimed_client_playbook_agent_draft();

CREATE OR REPLACE FUNCTION service_claim_client_playbook_agent_drafts(target_limit INTEGER DEFAULT 3)
RETURNS TABLE(id UUID,organization_id UUID,client_app_id UUID,client_contact_id UUID,channel TEXT,playbook_name TEXT,playbook_description TEXT,trigger_type TEXT,subject_template TEXT,body_template TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service role required'; END IF;
  IF target_limit NOT BETWEEN 1 AND 10 THEN RAISE EXCEPTION 'Invalid limit'; END IF;
  UPDATE client_playbook_drafts draft SET agent_status='failed',agent_failure_code='agent_attempts_exhausted',agent_claimed_at=NULL
  WHERE draft.status='draft' AND draft.agent_status='processing' AND draft.agent_claimed_at<NOW()-INTERVAL '15 minutes' AND draft.agent_attempt_count>=3;
  UPDATE client_playbook_drafts draft SET agent_status='pending',agent_failure_code='stale_claim_recovered',agent_claimed_at=NULL
  WHERE draft.status='draft' AND draft.agent_status='processing' AND draft.agent_claimed_at<NOW()-INTERVAL '15 minutes' AND draft.agent_attempt_count<3;
  RETURN QUERY WITH candidates AS (
    SELECT draft.id FROM client_playbook_drafts draft
    JOIN client_playbooks playbook ON playbook.id=draft.playbook_id AND playbook.status='active'
    JOIN client_apps app ON app.id=draft.client_app_id AND app.organization_id=draft.organization_id AND app.status='active' AND app.client_success_enabled=TRUE AND app.relationship_state<>'closed' AND app.client_segment=ANY(playbook.eligible_client_segments) AND app.relationship_state=ANY(playbook.eligible_relationship_states)
    JOIN client_contacts contact ON contact.id=draft.client_contact_id AND contact.client_app_id=app.id AND contact.organization_id=draft.organization_id AND (draft.channel='email' OR contact.slack_assignment_status IN ('assigned','linked'))
    LEFT JOIN LATERAL (SELECT subscription.status FROM client_subscriptions subscription WHERE subscription.client_app_id=app.id ORDER BY CASE subscription.status WHEN 'active' THEN 1 WHEN 'trialing' THEN 2 WHEN 'past_due' THEN 3 WHEN 'unpaid' THEN 4 ELSE 5 END,subscription.synced_at DESC LIMIT 1) current_subscription ON TRUE
    JOIN automation_runtime_controls control ON control.organization_id=draft.organization_id AND control.globally_paused=FALSE
    WHERE draft.status='draft' AND draft.agent_status IN ('not_requested','pending') AND draft.agent_attempt_count<3 AND (cardinality(playbook.eligible_subscription_statuses)=0 OR COALESCE(current_subscription.status,'none')=ANY(playbook.eligible_subscription_statuses)) AND (playbook.trigger_type<>'stripe_cancellation' OR current_subscription.status='canceled') AND (playbook.trigger_type<>'churn_reactivation' OR app.relationship_state='churned')
    ORDER BY draft.created_at FOR UPDATE OF draft SKIP LOCKED LIMIT target_limit
  ), claimed AS (
    UPDATE client_playbook_drafts draft SET agent_status='processing',agent_attempt_count=agent_attempt_count+1,agent_claimed_at=NOW(),agent_failure_code=NULL
    FROM candidates WHERE draft.id=candidates.id RETURNING draft.*
  )
  SELECT claimed.id,claimed.organization_id,claimed.client_app_id,claimed.client_contact_id,claimed.channel,playbook.name,playbook.description,playbook.trigger_type,version.subject_template,version.body_template
  FROM claimed JOIN client_playbooks playbook ON playbook.id=claimed.playbook_id JOIN client_playbook_versions version ON version.playbook_id=claimed.playbook_id AND version.version=claimed.playbook_version;
END; $$;

CREATE OR REPLACE FUNCTION service_complete_client_playbook_agent_draft(target_draft_id UUID,target_subject TEXT,target_body TEXT,target_source_message_ids UUID[],target_context_warnings TEXT[],target_context_sha256 TEXT,target_context_message_count INTEGER,target_context_latest_message_at TIMESTAMPTZ,target_model TEXT,target_response_id TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE target client_playbook_drafts%ROWTYPE; source_count INTEGER; invalid_sources INTEGER;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service role required'; END IF;
  SELECT * INTO target FROM client_playbook_drafts WHERE id=target_draft_id FOR UPDATE;
  IF NOT FOUND OR target.status<>'draft' OR target.agent_status<>'processing' THEN RAISE EXCEPTION 'Claimed draft not found'; END IF;
  IF target.channel='email' AND char_length(trim(COALESCE(target_subject,''))) NOT BETWEEN 1 AND 998 THEN RAISE EXCEPTION 'Invalid subject'; END IF;
  IF target.channel='slack' AND NULLIF(trim(COALESCE(target_subject,'')),'') IS NOT NULL THEN RAISE EXCEPTION 'Slack subject must be empty'; END IF;
  IF char_length(trim(COALESCE(target_body,''))) NOT BETWEEN 1 AND 10000 OR COALESCE(target_context_sha256,'') !~ '^[0-9a-f]{64}$' OR target_context_message_count IS NULL OR target_context_message_count<0 OR (target_context_message_count=0 AND target_context_latest_message_at IS NOT NULL) OR char_length(trim(COALESCE(target_model,''))) NOT BETWEEN 1 AND 100 OR char_length(COALESCE(target_response_id,''))>200 THEN RAISE EXCEPTION 'Invalid agent result'; END IF;
  IF NOT COALESCE(target_context_warnings,'{}'::TEXT[]) <@ ARRAY['no_email_history','slack_history_unavailable','billing_state_uncertain','relationship_note_missing']::TEXT[] THEN RAISE EXCEPTION 'Invalid context warning'; END IF;
  SELECT COUNT(*),COUNT(*) FILTER (WHERE message.id IS NULL) INTO source_count,invalid_sources FROM unnest(COALESCE(target_source_message_ids,'{}'::UUID[])) WITH ORDINALITY source(message_id,ordinal) LEFT JOIN client_email_messages message ON message.id=source.message_id AND message.organization_id=target.organization_id AND message.client_app_id=target.client_app_id;
  IF invalid_sources>0 OR source_count>target_context_message_count OR source_count<>(SELECT COUNT(DISTINCT distinct_source.message_id) FROM unnest(COALESCE(target_source_message_ids,'{}'::UUID[])) AS distinct_source(message_id)) THEN RAISE EXCEPTION 'Invalid source messages'; END IF;
  DELETE FROM client_playbook_draft_sources WHERE draft_id=target.id;
  INSERT INTO client_playbook_draft_sources(draft_id,message_id,ordinal) SELECT target.id,source.message_id,source.ordinal::INTEGER FROM unnest(COALESCE(target_source_message_ids,'{}'::UUID[])) WITH ORDINALITY source(message_id,ordinal);
  UPDATE client_playbook_drafts SET subject=CASE WHEN target.channel='email' THEN trim(target_subject) ELSE NULL END,body=trim(target_body),generation_mode='agent',context_message_count=target_context_message_count,context_latest_message_at=target_context_latest_message_at,agent_status='completed',agent_claimed_at=NULL,agent_generated_at=NOW(),agent_model=trim(target_model),agent_response_id=NULLIF(trim(COALESCE(target_response_id,'')),''),agent_failure_code=NULL,agent_context_sha256=target_context_sha256,agent_context_warnings=COALESCE(target_context_warnings,'{}'::TEXT[]) WHERE id=target.id;
  INSERT INTO audit_events(organization_id,event_type,target_type,target_id,metadata) VALUES(target.organization_id,'client.playbook.agent_draft_completed','client_playbook_draft',target.id::TEXT,jsonb_build_object('playbook_id',target.playbook_id,'client_app_id',target.client_app_id,'generation_mode','agent','source_count',source_count,'context_warning_count',cardinality(COALESCE(target_context_warnings,'{}'::TEXT[])),'status','draft'));
END; $$;

CREATE OR REPLACE FUNCTION service_fail_client_playbook_agent_draft(target_draft_id UUID,target_failure_code TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE target client_playbook_drafts%ROWTYPE; clean_code TEXT;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service role required'; END IF;
  clean_code:=left(COALESCE(target_failure_code,'client_success_agent_failed'),100);
  IF clean_code !~ '^[A-Za-z0-9_.:-]{1,100}$' THEN clean_code:='client_success_agent_failed'; END IF;
  SELECT * INTO target FROM client_playbook_drafts WHERE id=target_draft_id FOR UPDATE;
  IF NOT FOUND OR target.status<>'draft' OR target.agent_status<>'processing' THEN RETURN; END IF;
  UPDATE client_playbook_drafts SET agent_status=CASE WHEN agent_attempt_count>=3 THEN 'failed' ELSE 'pending' END,agent_failure_code=clean_code,agent_claimed_at=NULL WHERE id=target.id;
  INSERT INTO audit_events(organization_id,event_type,target_type,target_id,metadata) VALUES(target.organization_id,'client.playbook.agent_draft_failed','client_playbook_draft',target.id::TEXT,jsonb_build_object('playbook_id',target.playbook_id,'client_app_id',target.client_app_id,'failure_code',clean_code,'retry_count',target.agent_attempt_count,'status',CASE WHEN target.agent_attempt_count>=3 THEN 'failed' ELSE 'pending' END));
END; $$;

CREATE OR REPLACE FUNCTION dashboard_create_client_playbook_draft(target_playbook_id UUID,target_client_app_id UUID,target_client_contact_id UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE playbook client_playbooks%ROWTYPE; version_row client_playbook_versions%ROWTYPE; app client_apps%ROWTYPE; contact client_contacts%ROWTYPE; subscription client_subscriptions%ROWTYPE;
DECLARE subscription_status TEXT; product_name TEXT; billing_interval TEXT; rendered_subject TEXT; rendered_body TEXT; recipient TEXT; new_id UUID;
BEGIN
 SELECT * INTO playbook FROM client_playbooks WHERE id=target_playbook_id;
 IF NOT FOUND OR playbook.status<>'active' OR playbook.trigger_type<>'manual_client_checkin' OR auth.uid() IS NULL OR NOT dashboard_is_org_member(playbook.organization_id) THEN RAISE EXCEPTION 'Active manual playbook not found'; END IF;
 SELECT * INTO app FROM client_apps WHERE id=target_client_app_id AND organization_id=playbook.organization_id AND status='active' AND client_success_enabled=TRUE;
 IF NOT FOUND OR app.relationship_state='closed' OR NOT app.client_segment=ANY(playbook.eligible_client_segments) OR NOT app.relationship_state=ANY(playbook.eligible_relationship_states) THEN RAISE EXCEPTION 'Client app is not eligible'; END IF;
 SELECT * INTO contact FROM client_contacts WHERE id=target_client_contact_id AND client_app_id=app.id AND organization_id=playbook.organization_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Client contact not found'; END IF;
 IF playbook.channel='slack' AND contact.slack_assignment_status NOT IN ('assigned','linked') THEN RAISE EXCEPTION 'Contact has no linked Slack conversation'; END IF;
 SELECT * INTO subscription FROM client_subscriptions WHERE client_app_id=app.id ORDER BY CASE status WHEN 'active' THEN 1 WHEN 'trialing' THEN 2 WHEN 'past_due' THEN 3 WHEN 'unpaid' THEN 4 ELSE 5 END,synced_at DESC LIMIT 1;
 subscription_status:=COALESCE(subscription.status,'none'); product_name:=COALESCE(subscription.product_name,subscription.price_nickname,'your subscription'); billing_interval:=COALESCE(subscription.billing_interval,'not available');
 IF cardinality(playbook.eligible_subscription_statuses)>0 AND NOT subscription_status=ANY(playbook.eligible_subscription_statuses) THEN RAISE EXCEPTION 'Client subscription state is not eligible for this playbook'; END IF;
 SELECT * INTO version_row FROM client_playbook_versions WHERE playbook_id=playbook.id AND version=playbook.current_version;
 IF NOT FOUND THEN RAISE EXCEPTION 'Playbook version not found'; END IF;
 rendered_subject:=version_row.subject_template; rendered_body:=version_row.body_template;
 rendered_subject:=replace(replace(replace(replace(replace(replace(COALESCE(rendered_subject,''),'{{clientName}}',app.name),'{{contactName}}',contact.name),'{{contactFirstName}}',split_part(contact.name,' ',1)),'{{subscriptionStatus}}',subscription_status),'{{productName}}',product_name),'{{billingInterval}}',billing_interval);
 rendered_body:=replace(replace(replace(replace(replace(replace(rendered_body,'{{clientName}}',app.name),'{{contactName}}',contact.name),'{{contactFirstName}}',split_part(contact.name,' ',1)),'{{subscriptionStatus}}',subscription_status),'{{productName}}',product_name),'{{billingInterval}}',billing_interval);
 recipient:=CASE WHEN playbook.channel='email' THEN contact.email ELSE COALESCE(contact.slack_chat_label,contact.slack_display_name,contact.slack_name,contact.name) END;
 INSERT INTO client_playbook_drafts(organization_id,playbook_id,playbook_version,client_app_id,client_contact_id,client_subscription_id,channel,recipient_label,subject,body,created_by_user_id) VALUES(playbook.organization_id,playbook.id,playbook.current_version,app.id,contact.id,subscription.id,playbook.channel,recipient,NULLIF(rendered_subject,''),rendered_body,auth.uid()) RETURNING id INTO new_id;
 INSERT INTO audit_events(organization_id,actor_user_id,event_type,target_type,target_id,metadata) VALUES(playbook.organization_id,auth.uid(),'client.playbook.draft_created','client_playbook_draft',new_id::TEXT,jsonb_build_object('client_app_id',app.id,'playbook_id',playbook.id,'version',playbook.current_version,'channel',playbook.channel,'status','draft'));
 RETURN new_id;
EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'An open draft already exists for this playbook and contact'; END; $$;

REVOKE ALL ON FUNCTION service_claim_client_playbook_agent_drafts(INTEGER) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION guard_claimed_client_playbook_agent_draft() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION service_complete_client_playbook_agent_draft(UUID,TEXT,TEXT,UUID[],TEXT[],TEXT,INTEGER,TIMESTAMPTZ,TEXT,TEXT) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION service_fail_client_playbook_agent_draft(UUID,TEXT) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION dashboard_create_client_playbook_draft(UUID,UUID,UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION service_claim_client_playbook_agent_drafts(INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION service_complete_client_playbook_agent_draft(UUID,TEXT,TEXT,UUID[],TEXT[],TEXT,INTEGER,TIMESTAMPTZ,TEXT,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION service_fail_client_playbook_agent_draft(UUID,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION dashboard_create_client_playbook_draft(UUID,UUID,UUID) TO authenticated;
COMMIT;
