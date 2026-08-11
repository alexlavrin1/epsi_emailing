-- Minimal, append-only ingestion ledger for verified Stripe webhooks.
-- The server-side service role bypasses RLS. No client-facing policies exist.

CREATE TABLE IF NOT EXISTS stripe_webhook_events (
  id                 TEXT PRIMARY KEY,
  event_type         TEXT NOT NULL,
  stripe_object_id   TEXT,
  stripe_customer_id TEXT,
  livemode           BOOLEAN NOT NULL DEFAULT FALSE,
  api_version        TEXT,
  event_created_at   TIMESTAMPTZ NOT NULL,
  status             TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'processing', 'processed', 'failed')),
  processing_error   TEXT,
  received_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_pending
  ON stripe_webhook_events (received_at)
  WHERE status IN ('pending', 'failed');

CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_object
  ON stripe_webhook_events (stripe_object_id, event_type);

ALTER TABLE stripe_webhook_events ENABLE ROW LEVEL SECURITY;
