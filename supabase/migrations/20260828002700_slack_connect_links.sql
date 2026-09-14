-- Allow operators to link an existing Slack Connect conversation directly.
BEGIN;

ALTER TABLE client_contacts
  ADD COLUMN IF NOT EXISTS slack_chat_url TEXT,
  ADD COLUMN IF NOT EXISTS slack_chat_label TEXT;

ALTER TABLE client_contacts DROP CONSTRAINT IF EXISTS client_contacts_slack_assignment_status_check;
ALTER TABLE client_contacts
  ADD CONSTRAINT client_contacts_slack_assignment_status_check
  CHECK (slack_assignment_status IN ('unassigned', 'pending', 'assigned', 'failed', 'linked'));

ALTER TABLE client_contacts DROP CONSTRAINT IF EXISTS client_contacts_slack_chat_link_check;
ALTER TABLE client_contacts
  ADD CONSTRAINT client_contacts_slack_chat_link_check CHECK (
    slack_chat_url IS NULL OR (
      char_length(slack_chat_url) <= 2048
      AND slack_chat_url ~* '^https://([a-z0-9-]+\.)*slack\.com(/|$)'
    )
  );

ALTER TABLE client_contacts DROP CONSTRAINT IF EXISTS client_contacts_slack_linked_status_check;
ALTER TABLE client_contacts
  ADD CONSTRAINT client_contacts_slack_linked_status_check CHECK (
    slack_assignment_status <> 'linked'
    OR (slack_chat_url IS NOT NULL AND char_length(trim(slack_chat_url)) > 0)
  );

ALTER TABLE client_contacts DROP CONSTRAINT IF EXISTS client_contacts_slack_chat_label_check;
ALTER TABLE client_contacts
  ADD CONSTRAINT client_contacts_slack_chat_label_check CHECK (
    slack_chat_label IS NULL OR char_length(trim(slack_chat_label)) BETWEEN 1 AND 120
  );

CREATE OR REPLACE FUNCTION dashboard_set_client_slack_chat_link(
  target_contact_id UUID, target_chat_url TEXT, target_chat_label TEXT DEFAULT NULL
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE target_contact client_contacts%ROWTYPE; normalized_url TEXT; normalized_label TEXT;
BEGIN
  SELECT * INTO target_contact FROM client_contacts WHERE id = target_contact_id;
  IF NOT FOUND OR auth.uid() IS NULL OR NOT dashboard_is_org_member(target_contact.organization_id) THEN RAISE EXCEPTION 'Client contact not found'; END IF;
  normalized_url := trim(COALESCE(target_chat_url, ''));
  normalized_label := NULLIF(trim(COALESCE(target_chat_label, '')), '');
  IF char_length(normalized_url) > 2048 OR normalized_url !~* '^https://([a-z0-9-]+\.)*slack\.com(/|$)' THEN RAISE EXCEPTION 'Invalid Slack chat link'; END IF;
  IF normalized_label IS NOT NULL AND char_length(normalized_label) > 120 THEN RAISE EXCEPTION 'Invalid Slack chat label'; END IF;
  UPDATE client_contacts SET
    slack_assignment_status = 'linked', slack_chat_url = normalized_url,
    slack_chat_label = normalized_label, slack_failure_code = NULL,
    slack_team_id = NULL, slack_user_id = NULL, slack_channel_id = NULL,
    slack_display_name = NULL
  WHERE id = target_contact_id;
  INSERT INTO audit_events (organization_id, actor_user_id, event_type, target_type, target_id, metadata)
  VALUES (target_contact.organization_id, auth.uid(), 'client.slack.chat_linked', 'client_contact', target_contact_id::TEXT,
    jsonb_build_object('client_app_id', target_contact.client_app_id, 'status', 'linked'));
END; $$;

REVOKE ALL ON FUNCTION dashboard_set_client_slack_chat_link(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dashboard_set_client_slack_chat_link(UUID, TEXT, TEXT) TO authenticated;

COMMIT;
