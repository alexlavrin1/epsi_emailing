-- Phase 6: durable, deduplicated alert delivery for exhausted recovery jobs.

BEGIN;

ALTER TABLE payment_recovery_cases
  ADD COLUMN IF NOT EXISTS last_reconciled_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_payment_recovery_cases_reconciliation
  ON payment_recovery_cases (last_reconciled_at ASC NULLS FIRST)
  WHERE state = 'open';

ALTER TABLE payment_recovery_messages
  ADD COLUMN IF NOT EXISTS failure_alert_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (failure_alert_status IN ('pending', 'sending', 'sent', 'failed')),
  ADD COLUMN IF NOT EXISTS failure_alert_attempt_count INTEGER NOT NULL DEFAULT 0
    CHECK (failure_alert_attempt_count >= 0),
  ADD COLUMN IF NOT EXISTS failure_alert_provider_message_id TEXT,
  ADD COLUMN IF NOT EXISTS failure_alert_last_error TEXT,
  ADD COLUMN IF NOT EXISTS failure_alerted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_payment_recovery_messages_failure_alert
  ON payment_recovery_messages (updated_at)
  WHERE status = 'failed' AND failure_alert_status IN ('pending', 'failed');

CREATE OR REPLACE FUNCTION claim_payment_recovery_failure_alert(p_message_id UUID)
RETURNS SETOF payment_recovery_messages
LANGUAGE SQL
SECURITY INVOKER
SET search_path = public
AS $$
  UPDATE payment_recovery_messages
     SET failure_alert_status = 'sending',
         failure_alert_attempt_count = failure_alert_attempt_count + 1,
         failure_alert_last_error = NULL,
         updated_at = NOW()
   WHERE id = p_message_id
     AND status = 'failed'
     AND failure_alert_status IN ('pending', 'failed')
  RETURNING *;
$$;

COMMIT;
