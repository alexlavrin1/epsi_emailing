BEGIN;

ALTER TABLE client_playbook_drafts
  ADD COLUMN IF NOT EXISTS agent_regeneration_feedback TEXT,
  ADD COLUMN IF NOT EXISTS agent_regeneration_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS agent_regeneration_requested_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS agent_regeneration_requested_at TIMESTAMPTZ;

ALTER TABLE client_playbook_drafts DROP CONSTRAINT IF EXISTS client_playbook_drafts_regeneration_feedback_check;
ALTER TABLE client_playbook_drafts ADD CONSTRAINT client_playbook_drafts_regeneration_feedback_check CHECK (agent_regeneration_feedback IS NULL OR char_length(agent_regeneration_feedback)<=4000);
ALTER TABLE client_playbook_drafts DROP CONSTRAINT IF EXISTS client_playbook_drafts_regeneration_count_check;
ALTER TABLE client_playbook_drafts ADD CONSTRAINT client_playbook_drafts_regeneration_count_check CHECK (agent_regeneration_count BETWEEN 0 AND 1000);

DROP FUNCTION IF EXISTS service_claim_client_playbook_agent_drafts(INTEGER);
CREATE OR REPLACE FUNCTION service_claim_client_playbook_agent_drafts(target_limit INTEGER DEFAULT 3)
RETURNS TABLE(id UUID,organization_id UUID,client_app_id UUID,client_contact_id UUID,channel TEXT,playbook_name TEXT,playbook_description TEXT,trigger_type TEXT,subject_template TEXT,body_template TEXT,agent_prompt TEXT,regeneration_feedback TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service role required'; END IF;
 IF target_limit NOT BETWEEN 1 AND 10 THEN RAISE EXCEPTION 'Invalid limit'; END IF;
 UPDATE client_playbook_drafts draft SET agent_status='failed',agent_failure_code='agent_attempts_exhausted',agent_claimed_at=NULL WHERE draft.status='draft' AND draft.agent_status='processing' AND draft.agent_claimed_at<NOW()-INTERVAL '15 minutes' AND draft.agent_attempt_count>=3;
 UPDATE client_playbook_drafts draft SET agent_status='pending',agent_failure_code='stale_claim_recovered',agent_claimed_at=NULL WHERE draft.status='draft' AND draft.agent_status='processing' AND draft.agent_claimed_at<NOW()-INTERVAL '15 minutes' AND draft.agent_attempt_count<3;
 RETURN QUERY WITH candidates AS (
  SELECT draft.id FROM client_playbook_drafts draft JOIN client_playbooks playbook ON playbook.id=draft.playbook_id AND playbook.status='active' JOIN client_apps app ON app.id=draft.client_app_id AND app.organization_id=draft.organization_id AND app.status='active' AND app.client_success_enabled=TRUE AND app.relationship_state<>'closed' AND app.client_segment=ANY(playbook.eligible_client_segments) AND app.relationship_state=ANY(playbook.eligible_relationship_states) JOIN client_contacts contact ON contact.id=draft.client_contact_id AND contact.client_app_id=app.id AND contact.organization_id=draft.organization_id AND (draft.channel='email' OR contact.slack_assignment_status IN ('assigned','linked')) LEFT JOIN LATERAL(SELECT subscription.status FROM client_subscriptions subscription WHERE subscription.client_app_id=app.id ORDER BY CASE subscription.status WHEN 'active' THEN 1 WHEN 'trialing' THEN 2 WHEN 'past_due' THEN 3 WHEN 'unpaid' THEN 4 ELSE 5 END,subscription.synced_at DESC LIMIT 1) current_subscription ON TRUE JOIN automation_runtime_controls control ON control.organization_id=draft.organization_id AND control.globally_paused=FALSE WHERE draft.status='draft' AND draft.agent_status IN ('not_requested','pending') AND draft.agent_attempt_count<3 AND (cardinality(playbook.eligible_subscription_statuses)=0 OR COALESCE(current_subscription.status,'none')=ANY(playbook.eligible_subscription_statuses)) AND (playbook.trigger_type<>'stripe_cancellation' OR current_subscription.status='canceled') AND (playbook.trigger_type<>'churn_reactivation' OR app.relationship_state='churned') ORDER BY draft.created_at FOR UPDATE OF draft SKIP LOCKED LIMIT target_limit
 ),claimed AS (UPDATE client_playbook_drafts draft SET agent_status='processing',agent_attempt_count=agent_attempt_count+1,agent_claimed_at=NOW(),agent_failure_code=NULL FROM candidates WHERE draft.id=candidates.id RETURNING draft.*)
 SELECT claimed.id,claimed.organization_id,claimed.client_app_id,claimed.client_contact_id,claimed.channel,playbook.name,playbook.description,playbook.trigger_type,version.subject_template,version.body_template,version.agent_prompt,claimed.agent_regeneration_feedback FROM claimed JOIN client_playbooks playbook ON playbook.id=claimed.playbook_id JOIN client_playbook_versions version ON version.playbook_id=claimed.playbook_id AND version.version=claimed.playbook_version;
END; $$;

CREATE OR REPLACE FUNCTION dashboard_regenerate_client_playbook_agent_draft(target_draft_id UUID,target_feedback TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE target client_playbook_drafts%ROWTYPE; clean_feedback TEXT; next_count INTEGER;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
 clean_feedback:=NULLIF(trim(COALESCE(target_feedback,'')),'');
 IF char_length(COALESCE(clean_feedback,''))>4000 THEN RAISE EXCEPTION 'Feedback is too long'; END IF;
 SELECT * INTO target FROM client_playbook_drafts WHERE id=target_draft_id FOR UPDATE;
 IF NOT FOUND OR NOT dashboard_is_org_member(target.organization_id) THEN RAISE EXCEPTION 'Client draft not found'; END IF;
 IF target.status<>'draft' OR target.agent_status IN ('pending','processing') THEN RAISE EXCEPTION 'Draft cannot be regenerated while processing or after a decision'; END IF;
 next_count:=target.agent_regeneration_count+1;
 IF next_count>1000 THEN RAISE EXCEPTION 'Regeneration limit reached'; END IF;
 DELETE FROM client_playbook_draft_sources WHERE draft_id=target.id;
 UPDATE client_playbook_drafts SET agent_status='pending',agent_attempt_count=0,agent_claimed_at=NULL,agent_generated_at=NULL,agent_model=NULL,agent_response_id=NULL,agent_failure_code=NULL,agent_context_sha256=NULL,agent_context_warnings='{}'::TEXT[],agent_regeneration_feedback=clean_feedback,agent_regeneration_count=next_count,agent_regeneration_requested_by_user_id=auth.uid(),agent_regeneration_requested_at=NOW(),generation_mode='template' WHERE id=target.id;
 INSERT INTO audit_events(organization_id,actor_user_id,event_type,target_type,target_id,metadata) VALUES(target.organization_id,auth.uid(),'client.playbook.agent_draft_regeneration_queued','client_playbook_draft',target.id::TEXT,jsonb_build_object('feedback_provided',clean_feedback IS NOT NULL,'feedback_length',char_length(COALESCE(clean_feedback,'')),'regeneration_count',next_count,'status','pending'));
END; $$;

REVOKE ALL ON FUNCTION service_claim_client_playbook_agent_drafts(INTEGER) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION dashboard_regenerate_client_playbook_agent_draft(UUID,TEXT) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION service_claim_client_playbook_agent_drafts(INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION dashboard_regenerate_client_playbook_agent_draft(UUID,TEXT) TO authenticated;

COMMIT;
