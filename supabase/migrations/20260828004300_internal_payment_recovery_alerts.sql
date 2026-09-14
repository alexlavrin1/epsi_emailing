-- Durable internal email and Slack alerts for actionable Stripe payments.
BEGIN;

ALTER TABLE payment_recovery_messages
  DROP CONSTRAINT IF EXISTS payment_recovery_messages_channel_check;

ALTER TABLE payment_recovery_messages
  ADD CONSTRAINT payment_recovery_messages_channel_check
  CHECK (channel IN ('email', 'slack', 'internal_email', 'internal_slack'));

COMMIT;
