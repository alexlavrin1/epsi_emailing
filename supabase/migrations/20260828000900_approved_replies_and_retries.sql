-- Phase 3: approval-gated manual replies and controlled recovery retries.
-- Also removes authenticated access to mailbox OAuth tokens. Provider secrets
-- remain available only to service-role backend jobs.

BEGIN;

REVOKE SELECT ON mailboxes FROM authenticated;
GRANT SELECT (id, email, display_name, signature, created_at, updated_at, organization_id)
  ON mailboxes TO authenticated;

CREATE TABLE IF NOT EXISTS operator_email_replies (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  prospect_reply_id   UUID NOT NULL REFERENCES prospect_replies(id) ON DELETE RESTRICT,
  body                TEXT NOT NULL CHECK (char_length(trim(body)) BETWEEN 1 AND 10000),
  status              TEXT NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft', 'queued', 'sending', 'sent', 'failed', 'cancelled')),
  attempt_count       INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 3),
  provider_message_id TEXT,
  last_error          TEXT,
  created_by_user_id  UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  queued_by_user_id   UUID REFERENCES auth.users(id) ON DELETE RESTRICT,
  queued_at           TIMESTAMPTZ,
  sent_at             TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((status IN ('queued', 'sending', 'sent', 'failed')) = (queued_at IS NOT NULL)),
  CHECK (status <> 'sent' OR sent_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_operator_email_replies_queue
  ON operator_email_replies (status, queued_at)
  WHERE status IN ('queued', 'failed');
CREATE INDEX IF NOT EXISTS idx_operator_email_replies_org_created
  ON operator_email_replies (organization_id, created_at DESC);

DROP TRIGGER IF EXISTS operator_email_replies_touch_updated_at ON operator_email_replies;
CREATE TRIGGER operator_email_replies_touch_updated_at BEFORE UPDATE ON operator_email_replies
FOR EACH ROW EXECUTE FUNCTION dashboard_touch_updated_at();

ALTER TABLE operator_email_replies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS operator_email_replies_member_read ON operator_email_replies;
CREATE POLICY operator_email_replies_member_read ON operator_email_replies FOR SELECT TO authenticated
USING (dashboard_is_org_member(organization_id));

CREATE OR REPLACE FUNCTION dashboard_reply_controls_ready()
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT auth.uid() IS NOT NULL; $$;

CREATE OR REPLACE FUNCTION dashboard_create_email_reply_draft(
  target_organization_id UUID,
  target_prospect_reply_id UUID,
  reply_body TEXT
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE new_id UUID;
BEGIN
  IF auth.uid() IS NULL OR NOT dashboard_is_org_member(target_organization_id) THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF char_length(trim(COALESCE(reply_body, ''))) NOT BETWEEN 1 AND 10000 THEN RAISE EXCEPTION 'Reply must contain 1 to 10000 characters'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM prospect_replies pr JOIN campaigns c ON c.id = pr.campaign_id
    WHERE pr.id = target_prospect_reply_id AND c.organization_id = target_organization_id
      AND pr.outreach_send_id IS NOT NULL AND pr.gmail_message_id IS NOT NULL
  ) THEN RAISE EXCEPTION 'Reply context not found'; END IF;

  INSERT INTO operator_email_replies (organization_id, prospect_reply_id, body, created_by_user_id)
  VALUES (target_organization_id, target_prospect_reply_id, trim(reply_body), auth.uid()) RETURNING id INTO new_id;
  INSERT INTO audit_events (organization_id, actor_user_id, event_type, target_type, target_id, metadata)
  VALUES (target_organization_id, auth.uid(), 'email.reply.draft_created', 'operator_email_reply', new_id::TEXT,
    jsonb_build_object('prospect_reply_id', target_prospect_reply_id));
  RETURN new_id;
END;
$$;

CREATE OR REPLACE FUNCTION dashboard_queue_email_reply(target_reply_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE target_reply operator_email_replies%ROWTYPE;
BEGIN
  SELECT * INTO target_reply FROM operator_email_replies WHERE id = target_reply_id FOR UPDATE;
  IF NOT FOUND OR auth.uid() IS NULL OR NOT dashboard_is_org_member(target_reply.organization_id) THEN RAISE EXCEPTION 'Draft not found'; END IF;
  IF target_reply.status NOT IN ('draft', 'failed') THEN RAISE EXCEPTION 'Draft cannot be queued from its current state'; END IF;

  UPDATE operator_email_replies SET status = 'queued', queued_by_user_id = auth.uid(), queued_at = NOW(),
    attempt_count = CASE WHEN target_reply.status = 'failed' THEN 0 ELSE attempt_count END, last_error = NULL
  WHERE id = target_reply_id;
  INSERT INTO audit_events (organization_id, actor_user_id, event_type, target_type, target_id, metadata)
  VALUES (target_reply.organization_id, auth.uid(), 'email.reply.queued', 'operator_email_reply', target_reply_id::TEXT,
    jsonb_build_object('previous_status', target_reply.status, 'prospect_reply_id', target_reply.prospect_reply_id));
END;
$$;

CREATE OR REPLACE FUNCTION dashboard_retry_recovery_message(
  target_organization_id UUID,
  target_message_id UUID
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE target_message payment_recovery_messages%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT dashboard_is_org_member(target_organization_id) THEN RAISE EXCEPTION 'Not authorized'; END IF;
  SELECT prm.* INTO target_message
  FROM payment_recovery_messages prm
  JOIN payment_recovery_cases prc ON prc.id = prm.recovery_case_id
  JOIN crm_customers cc ON cc.id = prc.crm_customer_id
  WHERE prm.id = target_message_id AND cc.organization_id = target_organization_id AND prc.state = 'open'
  FOR UPDATE OF prm;
  IF NOT FOUND THEN RAISE EXCEPTION 'Failed message not found'; END IF;
  IF target_message.status <> 'failed' THEN RAISE EXCEPTION 'Only failed messages can be retried'; END IF;

  UPDATE payment_recovery_messages SET status = 'queued', scheduled_for = NOW(), attempt_count = 0,
    last_error = NULL, failure_alert_status = 'pending', failure_alert_attempt_count = 0,
    failure_alert_last_error = NULL, updated_at = NOW()
  WHERE id = target_message_id;
  INSERT INTO audit_events (organization_id, actor_user_id, event_type, target_type, target_id, metadata)
  VALUES (target_organization_id, auth.uid(), 'recovery.delivery.retry_queued', 'payment_recovery_message', target_message_id::TEXT,
    jsonb_build_object('channel', target_message.channel, 'previous_attempt_count', target_message.attempt_count));
END;
$$;

CREATE OR REPLACE FUNCTION claim_operator_email_reply(target_reply_id UUID)
RETURNS SETOF operator_email_replies LANGUAGE SQL SECURITY INVOKER SET search_path = public
AS $$
  UPDATE operator_email_replies SET status = 'sending', attempt_count = attempt_count + 1, updated_at = NOW()
  WHERE id = target_reply_id AND status IN ('queued', 'failed') AND attempt_count < 3
  RETURNING *;
$$;

REVOKE ALL ON FUNCTION dashboard_reply_controls_ready() FROM PUBLIC;
REVOKE ALL ON FUNCTION dashboard_create_email_reply_draft(UUID, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION dashboard_queue_email_reply(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION dashboard_retry_recovery_message(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION claim_operator_email_reply(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dashboard_reply_controls_ready() TO authenticated;
GRANT EXECUTE ON FUNCTION dashboard_create_email_reply_draft(UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION dashboard_queue_email_reply(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION dashboard_retry_recovery_message(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION claim_operator_email_reply(UUID) TO service_role;

COMMIT;
