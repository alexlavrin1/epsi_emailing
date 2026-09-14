-- Existing-client workspace: app-level records, multiple contacts, mailbox
-- correspondence, and server-resolved Slack DM assignments.
BEGIN;

CREATE TABLE IF NOT EXISTS client_apps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(trim(name)) BETWEEN 1 AND 160),
  website_url TEXT NOT NULL CHECK (char_length(website_url) <= 2048 AND website_url ~* '^https?://[^[:space:]]+$'),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_by_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, organization_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_client_apps_org_name ON client_apps (organization_id, LOWER(name));
CREATE INDEX IF NOT EXISTS idx_client_apps_org_updated ON client_apps (organization_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS client_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_app_id UUID NOT NULL,
  name TEXT NOT NULL CHECK (char_length(trim(name)) BETWEEN 1 AND 160),
  email TEXT NOT NULL CHECK (char_length(email) <= 320 AND email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  slack_name TEXT CHECK (slack_name IS NULL OR char_length(trim(slack_name)) BETWEEN 1 AND 120),
  slack_assignment_status TEXT NOT NULL DEFAULT 'unassigned' CHECK (slack_assignment_status IN ('unassigned', 'pending', 'assigned', 'failed')),
  slack_team_id TEXT,
  slack_user_id TEXT,
  slack_channel_id TEXT,
  slack_display_name TEXT,
  slack_failure_code TEXT,
  last_email_sync_at TIMESTAMPTZ,
  created_by_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (client_app_id, organization_id) REFERENCES client_apps(id, organization_id) ON DELETE CASCADE,
  UNIQUE (id, organization_id),
  CHECK (
    slack_assignment_status <> 'assigned'
    OR (slack_team_id IS NOT NULL AND slack_user_id IS NOT NULL AND slack_channel_id IS NOT NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_client_contacts_org_email ON client_contacts (organization_id, LOWER(email));
CREATE INDEX IF NOT EXISTS idx_client_contacts_app ON client_contacts (client_app_id, created_at);
CREATE INDEX IF NOT EXISTS idx_client_contacts_slack_pending ON client_contacts (updated_at)
WHERE slack_assignment_status = 'pending';

CREATE TABLE IF NOT EXISTS client_email_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_app_id UUID NOT NULL,
  client_contact_id UUID NOT NULL,
  provider_message_id TEXT NOT NULL CHECK (char_length(provider_message_id) BETWEEN 1 AND 500),
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  mailbox_email TEXT NOT NULL CHECK (char_length(mailbox_email) <= 320),
  counterparty_email TEXT NOT NULL CHECK (char_length(counterparty_email) <= 320),
  subject TEXT CHECK (subject IS NULL OR char_length(subject) <= 998),
  body TEXT CHECK (body IS NULL OR char_length(body) <= 10000),
  occurred_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (client_app_id, organization_id) REFERENCES client_apps(id, organization_id) ON DELETE CASCADE,
  FOREIGN KEY (client_contact_id, organization_id) REFERENCES client_contacts(id, organization_id) ON DELETE CASCADE,
  UNIQUE (organization_id, provider_message_id)
);
CREATE INDEX IF NOT EXISTS idx_client_email_messages_app_time ON client_email_messages (client_app_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_client_email_messages_contact_time ON client_email_messages (client_contact_id, occurred_at DESC);

DROP TRIGGER IF EXISTS client_apps_touch_updated_at ON client_apps;
CREATE TRIGGER client_apps_touch_updated_at BEFORE UPDATE ON client_apps FOR EACH ROW EXECUTE FUNCTION dashboard_touch_updated_at();
DROP TRIGGER IF EXISTS client_contacts_touch_updated_at ON client_contacts;
CREATE TRIGGER client_contacts_touch_updated_at BEFORE UPDATE ON client_contacts FOR EACH ROW EXECUTE FUNCTION dashboard_touch_updated_at();

ALTER TABLE client_apps ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_email_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS client_apps_member_read ON client_apps;
CREATE POLICY client_apps_member_read ON client_apps FOR SELECT TO authenticated USING (dashboard_is_org_member(organization_id));
DROP POLICY IF EXISTS client_contacts_member_read ON client_contacts;
CREATE POLICY client_contacts_member_read ON client_contacts FOR SELECT TO authenticated USING (dashboard_is_org_member(organization_id));
DROP POLICY IF EXISTS client_email_messages_member_read ON client_email_messages;
CREATE POLICY client_email_messages_member_read ON client_email_messages FOR SELECT TO authenticated USING (dashboard_is_org_member(organization_id));
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON client_apps, client_contacts, client_email_messages FROM authenticated, anon;
GRANT SELECT ON client_apps, client_contacts, client_email_messages TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON client_apps, client_contacts, client_email_messages TO service_role;

CREATE OR REPLACE FUNCTION dashboard_create_client_app(
  target_organization_id UUID, target_name TEXT, target_website_url TEXT,
  target_contact_name TEXT, target_contact_email TEXT, target_slack_name TEXT DEFAULT NULL
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE new_app_id UUID; normalized_email TEXT; normalized_slack TEXT;
BEGIN
  IF auth.uid() IS NULL OR NOT dashboard_is_org_member(target_organization_id) THEN RAISE EXCEPTION 'Not authorized'; END IF;
  normalized_email := LOWER(trim(COALESCE(target_contact_email, '')));
  normalized_slack := NULLIF(trim(COALESCE(target_slack_name, '')), '');
  IF char_length(trim(COALESCE(target_name, ''))) NOT BETWEEN 1 AND 160 THEN RAISE EXCEPTION 'Invalid client app name'; END IF;
  IF char_length(COALESCE(target_website_url, '')) > 2048 OR trim(COALESCE(target_website_url, '')) !~* '^https?://[^[:space:]]+$' THEN RAISE EXCEPTION 'Invalid client website'; END IF;
  IF char_length(trim(COALESCE(target_contact_name, ''))) NOT BETWEEN 1 AND 160 OR normalized_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN RAISE EXCEPTION 'Invalid client contact'; END IF;
  IF normalized_slack IS NOT NULL AND char_length(normalized_slack) > 120 THEN RAISE EXCEPTION 'Invalid Slack name'; END IF;
  INSERT INTO client_apps (organization_id, name, website_url, created_by_user_id)
  VALUES (target_organization_id, trim(target_name), trim(target_website_url), auth.uid()) RETURNING id INTO new_app_id;
  INSERT INTO client_contacts (organization_id, client_app_id, name, email, slack_name, slack_assignment_status, created_by_user_id)
  VALUES (target_organization_id, new_app_id, trim(target_contact_name), normalized_email, normalized_slack,
    CASE WHEN normalized_slack IS NULL THEN 'unassigned' ELSE 'pending' END, auth.uid());
  INSERT INTO audit_events (organization_id, actor_user_id, event_type, target_type, target_id, metadata)
  VALUES (target_organization_id, auth.uid(), 'client.app.created', 'client_app', new_app_id::TEXT,
    jsonb_build_object('contact_count', 1, 'slack_requested', normalized_slack IS NOT NULL));
  RETURN new_app_id;
EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'A client app or contact with these details already exists';
END; $$;

CREATE OR REPLACE FUNCTION dashboard_add_client_contact(
  target_organization_id UUID, target_client_app_id UUID, target_name TEXT,
  target_email TEXT, target_slack_name TEXT DEFAULT NULL
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE new_contact_id UUID; normalized_email TEXT; normalized_slack TEXT;
BEGIN
  IF auth.uid() IS NULL OR NOT dashboard_is_org_member(target_organization_id) THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF NOT EXISTS (SELECT 1 FROM client_apps WHERE id = target_client_app_id AND organization_id = target_organization_id AND status = 'active') THEN RAISE EXCEPTION 'Client app not found'; END IF;
  normalized_email := LOWER(trim(COALESCE(target_email, '')));
  normalized_slack := NULLIF(trim(COALESCE(target_slack_name, '')), '');
  IF char_length(trim(COALESCE(target_name, ''))) NOT BETWEEN 1 AND 160 OR normalized_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN RAISE EXCEPTION 'Invalid client contact'; END IF;
  IF normalized_slack IS NOT NULL AND char_length(normalized_slack) > 120 THEN RAISE EXCEPTION 'Invalid Slack name'; END IF;
  INSERT INTO client_contacts (organization_id, client_app_id, name, email, slack_name, slack_assignment_status, created_by_user_id)
  VALUES (target_organization_id, target_client_app_id, trim(target_name), normalized_email, normalized_slack,
    CASE WHEN normalized_slack IS NULL THEN 'unassigned' ELSE 'pending' END, auth.uid()) RETURNING id INTO new_contact_id;
  INSERT INTO audit_events (organization_id, actor_user_id, event_type, target_type, target_id, metadata)
  VALUES (target_organization_id, auth.uid(), 'client.contact.created', 'client_contact', new_contact_id::TEXT,
    jsonb_build_object('client_app_id', target_client_app_id, 'slack_requested', normalized_slack IS NOT NULL));
  RETURN new_contact_id;
EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'That email is already assigned to a client';
END; $$;

CREATE OR REPLACE FUNCTION dashboard_request_client_slack_assignment(target_contact_id UUID, target_slack_name TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE target_contact client_contacts%ROWTYPE; normalized_slack TEXT;
BEGIN
  SELECT * INTO target_contact FROM client_contacts WHERE id = target_contact_id;
  IF NOT FOUND OR auth.uid() IS NULL OR NOT dashboard_is_org_member(target_contact.organization_id) THEN RAISE EXCEPTION 'Client contact not found'; END IF;
  normalized_slack := COALESCE(NULLIF(trim(COALESCE(target_slack_name, '')), ''), target_contact.slack_name);
  IF normalized_slack IS NULL OR char_length(normalized_slack) > 120 THEN RAISE EXCEPTION 'Add a valid Slack name before assigning a chat'; END IF;
  UPDATE client_contacts SET slack_name = normalized_slack, slack_assignment_status = 'pending', slack_failure_code = NULL WHERE id = target_contact_id;
  INSERT INTO audit_events (organization_id, actor_user_id, event_type, target_type, target_id, metadata)
  VALUES (target_contact.organization_id, auth.uid(), 'client.slack.assignment_requested', 'client_contact', target_contact_id::TEXT,
    jsonb_build_object('client_app_id', target_contact.client_app_id));
END; $$;

CREATE OR REPLACE FUNCTION service_complete_client_slack_assignment(
  target_contact_id UUID, target_team_id TEXT, target_user_id TEXT,
  target_channel_id TEXT, target_display_name TEXT DEFAULT NULL
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE target_contact client_contacts%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service role required'; END IF;
  SELECT * INTO target_contact FROM client_contacts WHERE id = target_contact_id FOR UPDATE;
  IF NOT FOUND OR target_contact.slack_assignment_status <> 'pending' THEN RETURN; END IF;
  IF COALESCE(target_team_id, '') = '' OR COALESCE(target_user_id, '') = '' OR COALESCE(target_channel_id, '') = '' THEN RAISE EXCEPTION 'Invalid Slack assignment'; END IF;
  UPDATE client_contacts SET slack_assignment_status = 'assigned', slack_team_id = target_team_id,
    slack_user_id = target_user_id, slack_channel_id = target_channel_id,
    slack_display_name = NULLIF(trim(COALESCE(target_display_name, '')), ''), slack_failure_code = NULL
  WHERE id = target_contact_id;
  INSERT INTO audit_events (organization_id, actor_user_id, event_type, target_type, target_id, metadata)
  VALUES (target_contact.organization_id, NULL, 'client.slack.assigned', 'client_contact', target_contact_id::TEXT,
    jsonb_build_object('client_app_id', target_contact.client_app_id, 'status', 'assigned'));
END; $$;

CREATE OR REPLACE FUNCTION service_fail_client_slack_assignment(target_contact_id UUID, target_failure_code TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE sanitized_failure_code TEXT;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service role required'; END IF;
  sanitized_failure_code := CASE WHEN target_failure_code ~ '^[A-Za-z0-9_.:-]{1,100}$' THEN target_failure_code ELSE 'slack_assignment_failed' END;
  UPDATE client_contacts SET slack_assignment_status = 'failed', slack_failure_code = sanitized_failure_code
  WHERE id = target_contact_id AND slack_assignment_status = 'pending';
END; $$;

REVOKE ALL ON FUNCTION dashboard_create_client_app(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION dashboard_add_client_contact(UUID, UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION dashboard_request_client_slack_assignment(UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION service_complete_client_slack_assignment(UUID, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION service_fail_client_slack_assignment(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dashboard_create_client_app(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION dashboard_add_client_contact(UUID, UUID, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION dashboard_request_client_slack_assignment(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION service_complete_client_slack_assignment(UUID, TEXT, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION service_fail_client_slack_assignment(UUID, TEXT) TO service_role;

-- Client correspondence is covered by the existing disabled-by-default email
-- content retention preview. No deletion executor is introduced here.
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
      WHEN 'crm_notes' THEN (SELECT COUNT(*) FROM crm_contact_notes WHERE organization_id = target_organization_id AND created_at < NOW() - make_interval(days => policy.retention_days))
      WHEN 'audit_history' THEN (SELECT COUNT(*) FROM audit_events WHERE organization_id = target_organization_id AND created_at < NOW() - make_interval(days => policy.retention_days)) ELSE 0 END::BIGINT
  FROM data_retention_policies policy WHERE policy.organization_id = target_organization_id ORDER BY policy.category;
END; $$;

COMMIT;
