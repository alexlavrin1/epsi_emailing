-- Recover stale approved-email claims and prevent them from becoming inert.
BEGIN;

-- Recover records stranded by migration 042's former processing -> uncertain
-- transition. Explicit approval remains in force and the deterministic
-- Message-ID is reused for the bounded retry.
UPDATE client_playbook_drafts draft
   SET delivery_status=CASE WHEN draft.delivery_attempt_count<3 THEN 'queued' ELSE 'failed' END,
       delivery_claimed_at=NULL,
       delivery_failure_code='delivery_claim_expired'
 WHERE draft.channel='email'
   AND draft.status='approved'
   AND draft.delivery_status='uncertain'
   AND draft.delivery_failure_code='delivery_claim_expired';

CREATE OR REPLACE FUNCTION service_claim_client_playbook_email_deliveries(target_limit INTEGER DEFAULT 10)
RETURNS TABLE(id UUID,organization_id UUID,client_app_id UUID,recipient_email TEXT,subject TEXT,body TEXT,reply_to_message_id TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service role required'; END IF;
  IF target_limit NOT BETWEEN 1 AND 25 THEN RAISE EXCEPTION 'Invalid limit'; END IF;
  UPDATE client_playbook_drafts draft
     SET delivery_status=CASE WHEN draft.delivery_attempt_count<3 THEN 'queued' ELSE 'failed' END,
         delivery_failure_code='delivery_claim_expired',
         delivery_claimed_at=NULL
   WHERE draft.channel='email'
     AND draft.status='approved'
     AND draft.delivery_status='processing'
     AND draft.delivery_claimed_at<NOW()-INTERVAL '15 minutes';
  RETURN QUERY WITH candidates AS (
    SELECT draft.id FROM client_playbook_drafts draft
    JOIN client_apps app ON app.id=draft.client_app_id AND app.organization_id=draft.organization_id AND app.status='active' AND app.client_success_enabled=TRUE AND app.relationship_state<>'closed'
    JOIN client_contacts contact ON contact.id=draft.client_contact_id AND contact.client_app_id=app.id AND contact.organization_id=draft.organization_id AND lower(contact.email)=lower(draft.recipient_label)
    JOIN automation_runtime_controls control ON control.organization_id=draft.organization_id AND control.globally_paused=FALSE
    WHERE draft.channel='email' AND draft.status='approved' AND draft.delivery_status='queued' AND draft.delivery_attempt_count<3
    ORDER BY draft.delivery_queued_at FOR UPDATE OF draft SKIP LOCKED LIMIT target_limit
  ), claimed AS (
    UPDATE client_playbook_drafts draft SET delivery_status='processing',delivery_attempt_count=draft.delivery_attempt_count+1,delivery_claimed_at=NOW(),delivery_failure_code=NULL
    FROM candidates WHERE draft.id=candidates.id RETURNING draft.*
  )
  SELECT claimed.id,claimed.organization_id,claimed.client_app_id,contact.email,claimed.subject,claimed.body,source.provider_message_id
  FROM claimed JOIN client_contacts contact ON contact.id=claimed.client_contact_id
  LEFT JOIN LATERAL(
    SELECT message.provider_message_id FROM client_playbook_draft_sources citation
    JOIN client_email_messages message ON message.id=citation.message_id
    WHERE citation.draft_id=claimed.id AND message.direction='inbound'
    ORDER BY message.occurred_at DESC LIMIT 1
  ) source ON TRUE;
END; $$;

REVOKE ALL ON FUNCTION service_claim_client_playbook_email_deliveries(INTEGER) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION service_claim_client_playbook_email_deliveries(INTEGER) TO service_role;

COMMIT;
