-- Approval-gated delivery for client-success email drafts.
BEGIN;

ALTER TABLE client_playbook_drafts
  ADD COLUMN IF NOT EXISTS delivery_status TEXT NOT NULL DEFAULT 'not_requested',
  ADD COLUMN IF NOT EXISTS delivery_attempt_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS delivery_queued_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivery_claimed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivery_failure_code TEXT,
  ADD COLUMN IF NOT EXISTS provider_message_id TEXT;

ALTER TABLE client_playbook_drafts DROP CONSTRAINT IF EXISTS client_playbook_drafts_delivery_status_check;
ALTER TABLE client_playbook_drafts ADD CONSTRAINT client_playbook_drafts_delivery_status_check
  CHECK (delivery_status IN ('not_requested','queued','processing','sent','failed','uncertain'));
ALTER TABLE client_playbook_drafts DROP CONSTRAINT IF EXISTS client_playbook_drafts_delivery_attempt_count_check;
ALTER TABLE client_playbook_drafts ADD CONSTRAINT client_playbook_drafts_delivery_attempt_count_check
  CHECK (delivery_attempt_count BETWEEN 0 AND 3);
ALTER TABLE client_playbook_drafts DROP CONSTRAINT IF EXISTS client_playbook_drafts_delivery_metadata_check;
ALTER TABLE client_playbook_drafts ADD CONSTRAINT client_playbook_drafts_delivery_metadata_check CHECK (
  (delivery_status='not_requested') OR
  (delivery_status='queued' AND delivery_queued_at IS NOT NULL) OR
  (delivery_status='processing' AND delivery_queued_at IS NOT NULL AND delivery_claimed_at IS NOT NULL) OR
  (delivery_status='sent' AND delivered_at IS NOT NULL AND provider_message_id IS NOT NULL) OR
  (delivery_status IN ('failed','uncertain') AND delivery_failure_code IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_client_playbook_email_delivery_queue
  ON client_playbook_drafts(delivery_status,delivery_queued_at)
  WHERE channel='email' AND status='approved';

CREATE OR REPLACE FUNCTION dashboard_decide_client_playbook_draft(target_draft_id UUID,target_decision TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE target client_playbook_drafts%ROWTYPE; new_status TEXT; new_delivery_status TEXT;
BEGIN
  IF target_decision NOT IN ('approve','cancel') THEN RAISE EXCEPTION 'Invalid draft decision'; END IF;
  SELECT * INTO target FROM client_playbook_drafts WHERE id=target_draft_id FOR UPDATE;
  IF NOT FOUND OR auth.uid() IS NULL OR NOT dashboard_is_org_member(target.organization_id) THEN RAISE EXCEPTION 'Draft not found'; END IF;
  IF target.status<>'draft' THEN RAISE EXCEPTION 'Draft decision already recorded'; END IF;
  IF target_decision='approve' AND target.channel='email' AND target.agent_status IN ('pending','processing') THEN RAISE EXCEPTION 'Draft generation is still in progress'; END IF;
  new_status:=CASE WHEN target_decision='approve' THEN 'approved' ELSE 'cancelled' END;
  new_delivery_status:=CASE WHEN target_decision='approve' AND target.channel='email' THEN 'queued' ELSE 'not_requested' END;
  UPDATE client_playbook_drafts SET
    status=new_status,decided_by_user_id=auth.uid(),decided_at=NOW(),delivery_status=new_delivery_status,
    delivery_queued_at=CASE WHEN new_delivery_status='queued' THEN NOW() ELSE NULL END,
    delivery_claimed_at=NULL,delivered_at=NULL,delivery_failure_code=NULL,provider_message_id=NULL
  WHERE id=target.id;
  INSERT INTO audit_events(organization_id,actor_user_id,event_type,target_type,target_id,metadata)
  VALUES(target.organization_id,auth.uid(),CASE WHEN new_delivery_status='queued' THEN 'client.playbook.email_queued' WHEN new_status='approved' THEN 'client.playbook.draft_approved' ELSE 'client.playbook.draft_cancelled' END,'client_playbook_draft',target.id::TEXT,jsonb_build_object('channel',target.channel,'status',new_status,'delivery_status',new_delivery_status,'client_app_id',target.client_app_id,'playbook_id',target.playbook_id,'version',target.playbook_version));
END; $$;

CREATE OR REPLACE FUNCTION service_claim_client_playbook_email_deliveries(target_limit INTEGER DEFAULT 10)
RETURNS TABLE(id UUID,organization_id UUID,client_app_id UUID,recipient_email TEXT,subject TEXT,body TEXT,reply_to_message_id TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service role required'; END IF;
  IF target_limit NOT BETWEEN 1 AND 25 THEN RAISE EXCEPTION 'Invalid limit'; END IF;
  UPDATE client_playbook_drafts SET delivery_status=CASE WHEN delivery_attempt_count<3 THEN 'queued' ELSE 'failed' END,delivery_failure_code='delivery_claim_expired',delivery_claimed_at=NULL
  WHERE channel='email' AND status='approved' AND delivery_status='processing' AND delivery_claimed_at<NOW()-INTERVAL '15 minutes';
  RETURN QUERY WITH candidates AS (
    SELECT draft.id FROM client_playbook_drafts draft
    JOIN client_apps app ON app.id=draft.client_app_id AND app.organization_id=draft.organization_id AND app.status='active' AND app.client_success_enabled=TRUE AND app.relationship_state<>'closed'
    JOIN client_contacts contact ON contact.id=draft.client_contact_id AND contact.client_app_id=app.id AND contact.organization_id=draft.organization_id AND lower(contact.email)=lower(draft.recipient_label)
    JOIN automation_runtime_controls control ON control.organization_id=draft.organization_id AND control.globally_paused=FALSE
    WHERE draft.channel='email' AND draft.status='approved' AND draft.delivery_status='queued' AND draft.delivery_attempt_count<3
    ORDER BY draft.delivery_queued_at FOR UPDATE OF draft SKIP LOCKED LIMIT target_limit
  ), claimed AS (
    UPDATE client_playbook_drafts draft SET delivery_status='processing',delivery_attempt_count=delivery_attempt_count+1,delivery_claimed_at=NOW(),delivery_failure_code=NULL
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

CREATE OR REPLACE FUNCTION service_complete_client_playbook_email_delivery(target_draft_id UUID,target_provider_message_id TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE target client_playbook_drafts%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service role required'; END IF;
  IF char_length(trim(COALESCE(target_provider_message_id,''))) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Invalid provider message id'; END IF;
  SELECT * INTO target FROM client_playbook_drafts WHERE id=target_draft_id FOR UPDATE;
  IF NOT FOUND OR target.delivery_status<>'processing' THEN RETURN; END IF;
  UPDATE client_playbook_drafts SET delivery_status='sent',delivered_at=NOW(),delivery_claimed_at=NULL,delivery_failure_code=NULL,provider_message_id=trim(target_provider_message_id) WHERE id=target.id;
  INSERT INTO audit_events(organization_id,event_type,target_type,target_id,metadata) VALUES(target.organization_id,'client.playbook.email_sent','client_playbook_draft',target.id::TEXT,jsonb_build_object('client_app_id',target.client_app_id,'playbook_id',target.playbook_id,'attempt',target.delivery_attempt_count,'status','sent'));
END; $$;

CREATE OR REPLACE FUNCTION service_fail_client_playbook_email_delivery(target_draft_id UUID,target_failure_code TEXT,target_retryable BOOLEAN DEFAULT TRUE)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE target client_playbook_drafts%ROWTYPE; clean_code TEXT; next_status TEXT;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service role required'; END IF;
  clean_code:=left(COALESCE(target_failure_code,'email_delivery_failed'),100);
  IF clean_code !~ '^[A-Za-z0-9_.:-]{1,100}$' THEN clean_code:='email_delivery_failed'; END IF;
  SELECT * INTO target FROM client_playbook_drafts WHERE id=target_draft_id FOR UPDATE;
  IF NOT FOUND OR target.delivery_status<>'processing' THEN RETURN; END IF;
  next_status:=CASE WHEN target_retryable AND target.delivery_attempt_count<3 THEN 'queued' ELSE 'failed' END;
  UPDATE client_playbook_drafts SET delivery_status=next_status,delivery_claimed_at=NULL,delivery_failure_code=clean_code WHERE id=target.id;
  INSERT INTO audit_events(organization_id,event_type,target_type,target_id,metadata) VALUES(target.organization_id,'client.playbook.email_delivery_failed','client_playbook_draft',target.id::TEXT,jsonb_build_object('client_app_id',target.client_app_id,'playbook_id',target.playbook_id,'attempt',target.delivery_attempt_count,'failure_code',clean_code,'status',next_status));
END; $$;

REVOKE ALL ON FUNCTION dashboard_decide_client_playbook_draft(UUID,TEXT) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION service_claim_client_playbook_email_deliveries(INTEGER) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION service_complete_client_playbook_email_delivery(UUID,TEXT) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION service_fail_client_playbook_email_delivery(UUID,TEXT,BOOLEAN) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION dashboard_decide_client_playbook_draft(UUID,TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION service_claim_client_playbook_email_deliveries(INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION service_complete_client_playbook_email_delivery(UUID,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION service_fail_client_playbook_email_delivery(UUID,TEXT,BOOLEAN) TO service_role;

COMMIT;
