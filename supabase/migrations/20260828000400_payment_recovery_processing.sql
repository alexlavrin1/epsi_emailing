-- Atomic Stripe-event claiming for Phase 4 workers.

BEGIN;

CREATE OR REPLACE FUNCTION claim_stripe_webhook_events(p_limit INTEGER DEFAULT 25)
RETURNS SETOF stripe_webhook_events
LANGUAGE SQL
SECURITY INVOKER
SET search_path = public
AS $$
  WITH claimable AS (
    SELECT id
      FROM stripe_webhook_events
     WHERE status IN ('pending', 'failed')
     ORDER BY received_at ASC
     FOR UPDATE SKIP LOCKED
     LIMIT LEAST(GREATEST(p_limit, 1), 100)
  )
  UPDATE stripe_webhook_events AS events
     SET status = 'processing',
         processing_error = NULL
    FROM claimable
   WHERE events.id = claimable.id
  RETURNING events.*;
$$;

COMMIT;
