-- Phase 8, slice 3: versioned client-success playbooks and inert,
-- approval-gated email or Slack drafts. No provider delivery is introduced.
BEGIN;

CREATE TABLE IF NOT EXISTS client_playbooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(trim(name)) BETWEEN 3 AND 120),
  description TEXT NOT NULL DEFAULT '' CHECK (char_length(description) <= 500),
  channel TEXT NOT NULL CHECK (channel IN ('email', 'slack')),
  trigger_type TEXT NOT NULL DEFAULT 'manual_client_checkin' CHECK (trigger_type IN ('manual_client_checkin')),
  eligible_subscription_statuses TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'paused')),
  approval_mode TEXT NOT NULL DEFAULT 'required' CHECK (approval_mode = 'required'),
  current_version INTEGER NOT NULL DEFAULT 1 CHECK (current_version > 0),
  created_by_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  updated_by_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, name),
  CHECK (eligible_subscription_statuses <@ ARRAY['none','incomplete','incomplete_expired','trialing','active','past_due','canceled','unpaid','paused']::TEXT[])
);

CREATE TABLE IF NOT EXISTS client_playbook_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  playbook_id UUID NOT NULL REFERENCES client_playbooks(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK (version > 0),
  subject_template TEXT,
  body_template TEXT NOT NULL CHECK (char_length(trim(body_template)) BETWEEN 1 AND 10000),
  definition JSONB NOT NULL,
  created_by_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (playbook_id, version),
  CHECK (subject_template IS NULL OR char_length(trim(subject_template)) BETWEEN 1 AND 998)
);

CREATE TABLE IF NOT EXISTS client_playbook_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  playbook_id UUID NOT NULL REFERENCES client_playbooks(id) ON DELETE RESTRICT,
  playbook_version INTEGER NOT NULL,
  client_app_id UUID NOT NULL,
  client_contact_id UUID NOT NULL,
  client_subscription_id UUID REFERENCES client_subscriptions(id) ON DELETE SET NULL,
  channel TEXT NOT NULL CHECK (channel IN ('email', 'slack')),
  recipient_label TEXT NOT NULL CHECK (char_length(recipient_label) BETWEEN 1 AND 320),
  subject TEXT,
  body TEXT NOT NULL CHECK (char_length(trim(body)) BETWEEN 1 AND 10000),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'cancelled')),
  created_by_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  decided_by_user_id UUID REFERENCES auth.users(id) ON DELETE RESTRICT,
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (playbook_id, playbook_version) REFERENCES client_playbook_versions(playbook_id, version) ON DELETE RESTRICT,
  FOREIGN KEY (client_app_id, organization_id) REFERENCES client_apps(id, organization_id) ON DELETE CASCADE,
  FOREIGN KEY (client_contact_id, organization_id) REFERENCES client_contacts(id, organization_id) ON DELETE CASCADE,
  CHECK (subject IS NULL OR char_length(trim(subject)) BETWEEN 1 AND 998),
  CHECK ((status = 'draft' AND decided_at IS NULL AND decided_by_user_id IS NULL) OR (status <> 'draft' AND decided_at IS NOT NULL AND decided_by_user_id IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_client_playbook_one_open_draft
  ON client_playbook_drafts (playbook_id, client_app_id, client_contact_id, channel)
  WHERE status = 'draft';
CREATE INDEX IF NOT EXISTS idx_client_playbook_drafts_org_status
  ON client_playbook_drafts (organization_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_client_playbooks_org_updated
  ON client_playbooks (organization_id, updated_at DESC);

DROP TRIGGER IF EXISTS client_playbooks_touch_updated_at ON client_playbooks;
CREATE TRIGGER client_playbooks_touch_updated_at BEFORE UPDATE ON client_playbooks FOR EACH ROW EXECUTE FUNCTION dashboard_touch_updated_at();
DROP TRIGGER IF EXISTS client_playbook_drafts_touch_updated_at ON client_playbook_drafts;
CREATE TRIGGER client_playbook_drafts_touch_updated_at BEFORE UPDATE ON client_playbook_drafts FOR EACH ROW EXECUTE FUNCTION dashboard_touch_updated_at();

ALTER TABLE client_playbooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_playbook_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_playbook_drafts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS client_playbooks_member_read ON client_playbooks;
DROP POLICY IF EXISTS client_playbook_versions_member_read ON client_playbook_versions;
DROP POLICY IF EXISTS client_playbook_drafts_member_read ON client_playbook_drafts;
CREATE POLICY client_playbooks_member_read ON client_playbooks FOR SELECT TO authenticated USING (dashboard_is_org_member(organization_id));
CREATE POLICY client_playbook_versions_member_read ON client_playbook_versions FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM client_playbooks p WHERE p.id = playbook_id AND dashboard_is_org_member(p.organization_id)));
CREATE POLICY client_playbook_drafts_member_read ON client_playbook_drafts FOR SELECT TO authenticated USING (dashboard_is_org_member(organization_id));
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON client_playbooks, client_playbook_versions, client_playbook_drafts FROM authenticated, anon;
GRANT SELECT ON client_playbooks, client_playbook_versions, client_playbook_drafts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON client_playbooks, client_playbook_versions, client_playbook_drafts TO service_role;

CREATE OR REPLACE FUNCTION dashboard_client_playbooks_ready() RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$ SELECT auth.uid() IS NOT NULL; $$;

CREATE OR REPLACE FUNCTION dashboard_create_client_playbook(
  target_organization_id UUID, target_name TEXT, target_description TEXT, target_channel TEXT,
  target_eligible_statuses TEXT[], target_subject_template TEXT, target_body_template TEXT
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE new_id UUID; normalized_subject TEXT; clean_template TEXT;
BEGIN
  IF auth.uid() IS NULL OR NOT dashboard_has_org_role(target_organization_id, ARRAY['admin']) THEN RAISE EXCEPTION 'Administrator access required'; END IF;
  IF char_length(trim(COALESCE(target_name, ''))) NOT BETWEEN 3 AND 120 OR char_length(COALESCE(target_description, '')) > 500 THEN RAISE EXCEPTION 'Invalid playbook identity'; END IF;
  IF target_channel NOT IN ('email', 'slack') THEN RAISE EXCEPTION 'Invalid playbook channel'; END IF;
  IF NOT COALESCE(target_eligible_statuses, '{}'::TEXT[]) <@ ARRAY['none','incomplete','incomplete_expired','trialing','active','past_due','canceled','unpaid','paused']::TEXT[] THEN RAISE EXCEPTION 'Invalid subscription condition'; END IF;
  normalized_subject := NULLIF(trim(COALESCE(target_subject_template, '')), '');
  IF target_channel = 'email' AND (normalized_subject IS NULL OR char_length(normalized_subject) > 998) THEN RAISE EXCEPTION 'Email playbooks require a subject'; END IF;
  IF target_channel = 'slack' THEN normalized_subject := NULL; END IF;
  IF char_length(trim(COALESCE(target_body_template, ''))) NOT BETWEEN 1 AND 10000 THEN RAISE EXCEPTION 'Invalid playbook body'; END IF;
  clean_template := COALESCE(normalized_subject, '') || target_body_template;
  clean_template := replace(replace(replace(replace(replace(replace(clean_template, '{{clientName}}', ''), '{{contactName}}', ''), '{{contactFirstName}}', ''), '{{subscriptionStatus}}', ''), '{{productName}}', ''), '{{billingInterval}}', '');
  IF clean_template ~ '\{\{[^}]+\}\}' THEN RAISE EXCEPTION 'Unsupported template variable'; END IF;
  INSERT INTO client_playbooks (organization_id,name,description,channel,eligible_subscription_statuses,created_by_user_id,updated_by_user_id)
  VALUES (target_organization_id,trim(target_name),trim(COALESCE(target_description,'')),target_channel,COALESCE(target_eligible_statuses,'{}'::TEXT[]),auth.uid(),auth.uid()) RETURNING id INTO new_id;
  INSERT INTO client_playbook_versions (playbook_id,version,subject_template,body_template,definition,created_by_user_id)
  VALUES (new_id,1,normalized_subject,trim(target_body_template),jsonb_build_object('trigger','manual_client_checkin','channel',target_channel,'eligible_subscription_statuses',COALESCE(target_eligible_statuses,'{}'::TEXT[]),'approval','required'),auth.uid());
  INSERT INTO audit_events (organization_id,actor_user_id,event_type,target_type,target_id,metadata)
  VALUES (target_organization_id,auth.uid(),'client.playbook.created','client_playbook',new_id::TEXT,jsonb_build_object('version',1,'status','draft','channel',target_channel));
  RETURN new_id;
EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'A playbook with this name already exists';
END; $$;

CREATE OR REPLACE FUNCTION dashboard_set_client_playbook_status(target_playbook_id UUID, target_status TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE target client_playbooks%ROWTYPE;
BEGIN
  IF target_status NOT IN ('active','paused') THEN RAISE EXCEPTION 'Invalid playbook status'; END IF;
  SELECT * INTO target FROM client_playbooks WHERE id = target_playbook_id FOR UPDATE;
  IF NOT FOUND OR auth.uid() IS NULL OR NOT dashboard_has_org_role(target.organization_id, ARRAY['admin']) THEN RAISE EXCEPTION 'Playbook not found'; END IF;
  UPDATE client_playbooks SET status=target_status,updated_by_user_id=auth.uid() WHERE id=target_playbook_id;
  INSERT INTO audit_events (organization_id,actor_user_id,event_type,target_type,target_id,metadata)
  VALUES (target.organization_id,auth.uid(),'client.playbook.status_changed','client_playbook',target_playbook_id::TEXT,jsonb_build_object('previous_status',target.status,'new_status',target_status,'version',target.current_version));
END; $$;

CREATE OR REPLACE FUNCTION dashboard_create_client_playbook_draft(
  target_playbook_id UUID, target_client_app_id UUID, target_client_contact_id UUID
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE playbook client_playbooks%ROWTYPE; version_row client_playbook_versions%ROWTYPE; app client_apps%ROWTYPE; contact client_contacts%ROWTYPE; subscription client_subscriptions%ROWTYPE;
DECLARE subscription_status TEXT; product_name TEXT; billing_interval TEXT; rendered_subject TEXT; rendered_body TEXT; recipient TEXT; new_id UUID;
BEGIN
  SELECT * INTO playbook FROM client_playbooks WHERE id=target_playbook_id;
  IF NOT FOUND OR playbook.status <> 'active' OR auth.uid() IS NULL OR NOT dashboard_is_org_member(playbook.organization_id) THEN RAISE EXCEPTION 'Active playbook not found'; END IF;
  SELECT * INTO app FROM client_apps WHERE id=target_client_app_id AND organization_id=playbook.organization_id AND status='active';
  IF NOT FOUND THEN RAISE EXCEPTION 'Client app not found'; END IF;
  SELECT * INTO contact FROM client_contacts WHERE id=target_client_contact_id AND client_app_id=app.id AND organization_id=playbook.organization_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Client contact not found'; END IF;
  IF playbook.channel='slack' AND contact.slack_assignment_status NOT IN ('assigned','linked') THEN RAISE EXCEPTION 'Contact has no linked Slack conversation'; END IF;
  SELECT * INTO subscription FROM client_subscriptions WHERE client_app_id=app.id ORDER BY CASE status WHEN 'active' THEN 1 WHEN 'trialing' THEN 2 WHEN 'past_due' THEN 3 WHEN 'unpaid' THEN 4 ELSE 5 END, synced_at DESC LIMIT 1;
  subscription_status := COALESCE(subscription.status,'none');
  product_name := COALESCE(subscription.product_name,subscription.price_nickname,'your subscription');
  billing_interval := COALESCE(subscription.billing_interval,'not available');
  IF cardinality(playbook.eligible_subscription_statuses) > 0 AND NOT subscription_status = ANY(playbook.eligible_subscription_statuses) THEN RAISE EXCEPTION 'Client subscription state is not eligible for this playbook'; END IF;
  SELECT * INTO version_row FROM client_playbook_versions WHERE playbook_id=playbook.id AND version=playbook.current_version;
  IF NOT FOUND THEN RAISE EXCEPTION 'Playbook version not found'; END IF;
  rendered_subject := version_row.subject_template; rendered_body := version_row.body_template;
  rendered_subject := replace(replace(replace(replace(replace(replace(COALESCE(rendered_subject,''),'{{clientName}}',app.name),'{{contactName}}',contact.name),'{{contactFirstName}}',split_part(contact.name,' ',1)),'{{subscriptionStatus}}',subscription_status),'{{productName}}',product_name),'{{billingInterval}}',billing_interval);
  rendered_body := replace(replace(replace(replace(replace(replace(rendered_body,'{{clientName}}',app.name),'{{contactName}}',contact.name),'{{contactFirstName}}',split_part(contact.name,' ',1)),'{{subscriptionStatus}}',subscription_status),'{{productName}}',product_name),'{{billingInterval}}',billing_interval);
  recipient := CASE WHEN playbook.channel='email' THEN contact.email ELSE COALESCE(contact.slack_chat_label,contact.slack_display_name,contact.slack_name,contact.name) END;
  INSERT INTO client_playbook_drafts (organization_id,playbook_id,playbook_version,client_app_id,client_contact_id,client_subscription_id,channel,recipient_label,subject,body,created_by_user_id)
  VALUES (playbook.organization_id,playbook.id,playbook.current_version,app.id,contact.id,subscription.id,playbook.channel,recipient,NULLIF(rendered_subject,''),rendered_body,auth.uid()) RETURNING id INTO new_id;
  INSERT INTO audit_events (organization_id,actor_user_id,event_type,target_type,target_id,metadata)
  VALUES (playbook.organization_id,auth.uid(),'client.playbook.draft_created','client_playbook_draft',new_id::TEXT,jsonb_build_object('client_app_id',app.id,'playbook_id',playbook.id,'version',playbook.current_version,'channel',playbook.channel,'status','draft'));
  RETURN new_id;
EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'An open draft already exists for this playbook and contact';
END; $$;

CREATE OR REPLACE FUNCTION dashboard_update_client_playbook_draft(target_draft_id UUID,target_subject TEXT,target_body TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE target client_playbook_drafts%ROWTYPE; normalized_subject TEXT;
BEGIN
  SELECT * INTO target FROM client_playbook_drafts WHERE id=target_draft_id FOR UPDATE;
  IF NOT FOUND OR auth.uid() IS NULL OR NOT dashboard_is_org_member(target.organization_id) THEN RAISE EXCEPTION 'Draft not found'; END IF;
  IF target.status <> 'draft' THEN RAISE EXCEPTION 'Only open drafts can be edited'; END IF;
  normalized_subject := NULLIF(trim(COALESCE(target_subject,'')),'');
  IF target.channel='email' AND (normalized_subject IS NULL OR char_length(normalized_subject)>998) THEN RAISE EXCEPTION 'Email drafts require a subject'; END IF;
  IF char_length(trim(COALESCE(target_body,''))) NOT BETWEEN 1 AND 10000 THEN RAISE EXCEPTION 'Invalid draft body'; END IF;
  UPDATE client_playbook_drafts SET subject=CASE WHEN target.channel='email' THEN normalized_subject ELSE NULL END,body=trim(target_body) WHERE id=target_draft_id;
  INSERT INTO audit_events (organization_id,actor_user_id,event_type,target_type,target_id,metadata)
  VALUES (target.organization_id,auth.uid(),'client.playbook.draft_updated','client_playbook_draft',target_draft_id::TEXT,jsonb_build_object('channel',target.channel,'status','draft'));
END; $$;

CREATE OR REPLACE FUNCTION dashboard_decide_client_playbook_draft(target_draft_id UUID,target_decision TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE target client_playbook_drafts%ROWTYPE; new_status TEXT;
BEGIN
  IF target_decision NOT IN ('approve','cancel') THEN RAISE EXCEPTION 'Invalid draft decision'; END IF;
  SELECT * INTO target FROM client_playbook_drafts WHERE id=target_draft_id FOR UPDATE;
  IF NOT FOUND OR auth.uid() IS NULL OR NOT dashboard_is_org_member(target.organization_id) THEN RAISE EXCEPTION 'Draft not found'; END IF;
  IF target.status <> 'draft' THEN RAISE EXCEPTION 'Draft decision already recorded'; END IF;
  new_status := CASE WHEN target_decision='approve' THEN 'approved' ELSE 'cancelled' END;
  UPDATE client_playbook_drafts SET status=new_status,decided_by_user_id=auth.uid(),decided_at=NOW() WHERE id=target_draft_id;
  INSERT INTO audit_events (organization_id,actor_user_id,event_type,target_type,target_id,metadata)
  VALUES (target.organization_id,auth.uid(),CASE WHEN new_status='approved' THEN 'client.playbook.draft_approved' ELSE 'client.playbook.draft_cancelled' END,'client_playbook_draft',target_draft_id::TEXT,jsonb_build_object('channel',target.channel,'status',new_status,'client_app_id',target.client_app_id,'playbook_id',target.playbook_id,'version',target.playbook_version));
END; $$;

REVOKE ALL ON FUNCTION dashboard_client_playbooks_ready() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION dashboard_create_client_playbook(UUID,TEXT,TEXT,TEXT,TEXT[],TEXT,TEXT) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION dashboard_set_client_playbook_status(UUID,TEXT) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION dashboard_create_client_playbook_draft(UUID,UUID,UUID) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION dashboard_update_client_playbook_draft(UUID,TEXT,TEXT) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION dashboard_decide_client_playbook_draft(UUID,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION dashboard_client_playbooks_ready() TO authenticated;
GRANT EXECUTE ON FUNCTION dashboard_create_client_playbook(UUID,TEXT,TEXT,TEXT,TEXT[],TEXT,TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION dashboard_set_client_playbook_status(UUID,TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION dashboard_create_client_playbook_draft(UUID,UUID,UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION dashboard_update_client_playbook_draft(UUID,TEXT,TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION dashboard_decide_client_playbook_draft(UUID,TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION dashboard_retention_preview(target_organization_id UUID)
RETURNS TABLE(category TEXT, retention_days INTEGER, enabled BOOLEAN, eligible_rows BIGINT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT dashboard_has_org_role(target_organization_id, ARRAY['admin']) THEN RAISE EXCEPTION 'Administrator AAL2 access required'; END IF;
  RETURN QUERY SELECT policy.category, policy.retention_days, policy.enabled,
    CASE policy.category
      WHEN 'automation_history' THEN (SELECT COUNT(*) FROM automation_runs WHERE organization_id = target_organization_id AND created_at < NOW() - make_interval(days => policy.retention_days))
      WHEN 'worker_monitoring' THEN (SELECT COUNT(*) FROM automation_worker_cycles WHERE organization_id = target_organization_id AND started_at < NOW() - make_interval(days => policy.retention_days))
      WHEN 'email_content' THEN
        (SELECT COUNT(*) FROM prospect_replies reply JOIN campaigns campaign ON campaign.id = reply.campaign_id WHERE campaign.organization_id = target_organization_id AND COALESCE(reply.received_at, reply.created_at) < NOW() - make_interval(days => policy.retention_days))
        + (SELECT COUNT(*) FROM operator_email_replies WHERE organization_id = target_organization_id AND created_at < NOW() - make_interval(days => policy.retention_days))
        + (SELECT COUNT(*) FROM client_email_messages WHERE organization_id = target_organization_id AND occurred_at < NOW() - make_interval(days => policy.retention_days))
        + (SELECT COUNT(*) FROM client_playbook_drafts WHERE organization_id = target_organization_id AND created_at < NOW() - make_interval(days => policy.retention_days))
      WHEN 'crm_notes' THEN (SELECT COUNT(*) FROM crm_contact_notes WHERE organization_id = target_organization_id AND created_at < NOW() - make_interval(days => policy.retention_days))
      WHEN 'audit_history' THEN (SELECT COUNT(*) FROM audit_events WHERE organization_id = target_organization_id AND created_at < NOW() - make_interval(days => policy.retention_days)) ELSE 0 END::BIGINT
  FROM data_retention_policies policy WHERE policy.organization_id = target_organization_id ORDER BY policy.category;
END; $$;

COMMIT;
