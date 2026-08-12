-- Durable CRM identities, Stripe invoice recovery cases, and notification jobs.
-- All tables are service-role only: RLS is enabled and no client policies exist.

BEGIN;

CREATE TABLE IF NOT EXISTS crm_customers (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_customer_id TEXT UNIQUE NOT NULL,
  email              TEXT,
  name               TEXT,
  slack_team_id      TEXT,
  slack_user_id      TEXT,
  email_enabled      BOOLEAN NOT NULL DEFAULT TRUE,
  slack_enabled      BOOLEAN NOT NULL DEFAULT FALSE,
  status             TEXT NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active', 'suppressed')),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((slack_team_id IS NULL) = (slack_user_id IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_customers_slack_identity
  ON crm_customers (slack_team_id, slack_user_id)
  WHERE slack_team_id IS NOT NULL AND slack_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_crm_customers_email
  ON crm_customers (LOWER(email))
  WHERE email IS NOT NULL;

ALTER TABLE crm_customers ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS payment_recovery_cases (
  id                           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  crm_customer_id              UUID NOT NULL REFERENCES crm_customers(id) ON DELETE RESTRICT,
  stripe_invoice_id            TEXT UNIQUE NOT NULL,
  stripe_subscription_id       TEXT,
  stripe_payment_intent_id     TEXT,
  state                        TEXT NOT NULL DEFAULT 'open'
                               CHECK (state IN ('open', 'resolved', 'expired', 'void', 'cancelled')),
  invoice_status               TEXT NOT NULL,
  payment_intent_status        TEXT,
  amount_remaining             BIGINT NOT NULL CHECK (amount_remaining >= 0),
  currency                     TEXT NOT NULL CHECK (currency ~ '^[a-z]{3}$'),
  hosted_invoice_url           TEXT,
  last_stripe_event_created_at TIMESTAMPTZ NOT NULL,
  opened_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  next_reminder_at             TIMESTAMPTZ,
  resolved_at                  TIMESTAMPTZ,
  resolution_reason            TEXT,
  created_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    (state = 'open' AND resolved_at IS NULL)
    OR (state <> 'open' AND resolved_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_payment_recovery_cases_customer
  ON payment_recovery_cases (crm_customer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_payment_recovery_cases_due
  ON payment_recovery_cases (next_reminder_at)
  WHERE state = 'open' AND next_reminder_at IS NOT NULL;

ALTER TABLE payment_recovery_cases ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS payment_recovery_messages (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recovery_case_id    UUID NOT NULL REFERENCES payment_recovery_cases(id) ON DELETE CASCADE,
  channel             TEXT NOT NULL CHECK (channel IN ('email', 'slack')),
  step_number         INTEGER NOT NULL CHECK (step_number >= 1),
  status              TEXT NOT NULL DEFAULT 'queued'
                      CHECK (status IN ('queued', 'sending', 'sent', 'failed', 'cancelled')),
  scheduled_for       TIMESTAMPTZ NOT NULL,
  attempt_count       INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  provider_message_id TEXT,
  last_error          TEXT,
  sent_at             TIMESTAMPTZ,
  cancelled_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (recovery_case_id, channel, step_number),
  CHECK (status <> 'sent' OR sent_at IS NOT NULL),
  CHECK (status <> 'cancelled' OR cancelled_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_payment_recovery_messages_due
  ON payment_recovery_messages (scheduled_for)
  WHERE status IN ('queued', 'failed');

ALTER TABLE payment_recovery_messages ENABLE ROW LEVEL SECURITY;

-- Atomically claim one due message so concurrent workers cannot both send it.
CREATE OR REPLACE FUNCTION claim_payment_recovery_message(p_message_id UUID)
RETURNS SETOF payment_recovery_messages
LANGUAGE SQL
SECURITY INVOKER
SET search_path = public
AS $$
  UPDATE payment_recovery_messages
     SET status = 'sending',
         attempt_count = attempt_count + 1,
         updated_at = NOW()
   WHERE id = p_message_id
     AND status IN ('queued', 'failed')
  RETURNING *;
$$;

COMMIT;
