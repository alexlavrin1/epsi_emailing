-- Phase 8, slice 2: atomically claim stale client subscription snapshots for
-- scheduled reconciliation while allowing verified Stripe events to refresh
-- linked clients immediately.
BEGIN;

ALTER TABLE client_apps
  ADD COLUMN IF NOT EXISTS stripe_sync_claimed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_client_apps_stripe_sync_due
  ON client_apps (last_stripe_sync_at, created_at)
  WHERE stripe_customer_id IS NOT NULL AND status = 'active';

CREATE OR REPLACE FUNCTION claim_due_client_stripe_syncs(
  target_interval_minutes INTEGER DEFAULT 360, target_limit INTEGER DEFAULT 5
) RETURNS TABLE(client_app_id UUID, stripe_customer_id TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service role required'; END IF;
  IF target_interval_minutes NOT BETWEEN 15 AND 10080 OR target_limit NOT BETWEEN 1 AND 25 THEN RAISE EXCEPTION 'Invalid reconciliation limits'; END IF;
  RETURN QUERY
  WITH due AS (
    SELECT app.id
    FROM client_apps app
    WHERE app.status = 'active'
      AND app.stripe_customer_id IS NOT NULL
      AND (app.last_stripe_sync_at IS NULL OR app.last_stripe_sync_at <= NOW() - make_interval(mins => target_interval_minutes))
      AND (app.stripe_sync_claimed_at IS NULL OR app.stripe_sync_claimed_at <= NOW() - INTERVAL '15 minutes')
    ORDER BY app.last_stripe_sync_at ASC NULLS FIRST, app.created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT target_limit
  )
  UPDATE client_apps app SET stripe_sync_status = 'pending', stripe_sync_failure_code = NULL,
    stripe_sync_claimed_at = NOW()
  FROM due WHERE app.id = due.id
  RETURNING app.id, app.stripe_customer_id;
END; $$;

CREATE OR REPLACE FUNCTION service_replace_client_subscriptions(
  target_client_app_id UUID, target_stripe_customer_id TEXT,
  target_customer_email TEXT, target_customer_name TEXT, target_subscriptions JSONB
) RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE target_app client_apps%ROWTYPE; snapshot_count INTEGER;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service role required'; END IF;
  SELECT * INTO target_app FROM client_apps WHERE id = target_client_app_id FOR UPDATE;
  IF NOT FOUND OR target_app.stripe_customer_id IS DISTINCT FROM target_stripe_customer_id THEN RAISE EXCEPTION 'Client Stripe link changed'; END IF;
  IF jsonb_typeof(target_subscriptions) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid subscription snapshot'; END IF;
  DELETE FROM client_subscriptions WHERE client_app_id = target_client_app_id;
  INSERT INTO client_subscriptions (
    organization_id, client_app_id, stripe_customer_id, stripe_subscription_id, status,
    product_name, price_nickname, quantity, unit_amount, currency, billing_interval,
    interval_count, current_period_start, current_period_end, trial_end, cancel_at,
    cancel_at_period_end, canceled_at, latest_invoice_status, synced_at
  ) SELECT target_app.organization_id, target_client_app_id, target_stripe_customer_id,
    value->>'stripe_subscription_id', value->>'status', NULLIF(value->>'product_name', ''),
    NULLIF(value->>'price_nickname', ''), NULLIF(value->>'quantity', '')::INTEGER,
    NULLIF(value->>'unit_amount', '')::BIGINT, NULLIF(value->>'currency', ''),
    NULLIF(value->>'billing_interval', ''), NULLIF(value->>'interval_count', '')::INTEGER,
    NULLIF(value->>'current_period_start', '')::TIMESTAMPTZ, NULLIF(value->>'current_period_end', '')::TIMESTAMPTZ,
    NULLIF(value->>'trial_end', '')::TIMESTAMPTZ, NULLIF(value->>'cancel_at', '')::TIMESTAMPTZ,
    COALESCE((value->>'cancel_at_period_end')::BOOLEAN, FALSE), NULLIF(value->>'canceled_at', '')::TIMESTAMPTZ,
    NULLIF(value->>'latest_invoice_status', ''), NOW()
  FROM jsonb_array_elements(target_subscriptions) AS value;
  GET DIAGNOSTICS snapshot_count = ROW_COUNT;
  UPDATE client_apps SET stripe_customer_email = NULLIF(lower(trim(COALESCE(target_customer_email, ''))), ''),
    stripe_customer_name = NULLIF(trim(COALESCE(target_customer_name, '')), ''), stripe_sync_status = 'synced',
    stripe_sync_failure_code = NULL, stripe_sync_claimed_at = NULL, last_stripe_sync_at = NOW()
  WHERE id = target_client_app_id;
  RETURN snapshot_count;
END; $$;

CREATE OR REPLACE FUNCTION service_fail_client_stripe_sync(target_client_app_id UUID, target_failure_code TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE sanitized_code TEXT;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service role required'; END IF;
  sanitized_code := CASE WHEN target_failure_code ~ '^[a-z0-9_.:-]{1,100}$' THEN target_failure_code ELSE 'stripe_sync_failed' END;
  UPDATE client_apps SET stripe_sync_status = 'failed', stripe_sync_failure_code = sanitized_code,
    stripe_sync_claimed_at = NULL, last_stripe_sync_at = NOW()
  WHERE id = target_client_app_id AND stripe_customer_id IS NOT NULL;
END; $$;

REVOKE ALL ON FUNCTION claim_due_client_stripe_syncs(INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_due_client_stripe_syncs(INTEGER, INTEGER) TO service_role;

COMMIT;
