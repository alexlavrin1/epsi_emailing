-- Phase 8, slice 1: explicitly link an existing client app to Stripe and keep
-- a tenant-scoped, read-only subscription snapshot for the dashboard.
BEGIN;

ALTER TABLE client_apps
  ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT,
  ADD COLUMN IF NOT EXISTS stripe_customer_email TEXT,
  ADD COLUMN IF NOT EXISTS stripe_customer_name TEXT,
  ADD COLUMN IF NOT EXISTS stripe_sync_status TEXT NOT NULL DEFAULT 'unlinked',
  ADD COLUMN IF NOT EXISTS stripe_sync_failure_code TEXT,
  ADD COLUMN IF NOT EXISTS last_stripe_sync_at TIMESTAMPTZ;

ALTER TABLE client_apps DROP CONSTRAINT IF EXISTS client_apps_stripe_customer_id_check;
ALTER TABLE client_apps ADD CONSTRAINT client_apps_stripe_customer_id_check
  CHECK (stripe_customer_id IS NULL OR stripe_customer_id ~ '^cus_[A-Za-z0-9]+$');
ALTER TABLE client_apps DROP CONSTRAINT IF EXISTS client_apps_stripe_sync_status_check;
ALTER TABLE client_apps ADD CONSTRAINT client_apps_stripe_sync_status_check
  CHECK (stripe_sync_status IN ('unlinked', 'pending', 'synced', 'failed'));
ALTER TABLE client_apps DROP CONSTRAINT IF EXISTS client_apps_stripe_link_state_check;
ALTER TABLE client_apps ADD CONSTRAINT client_apps_stripe_link_state_check CHECK (
  (stripe_sync_status = 'unlinked' AND stripe_customer_id IS NULL)
  OR (stripe_sync_status <> 'unlinked' AND stripe_customer_id IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_client_apps_org_stripe_customer
  ON client_apps (organization_id, stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS client_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_app_id UUID NOT NULL,
  stripe_customer_id TEXT NOT NULL CHECK (stripe_customer_id ~ '^cus_[A-Za-z0-9]+$'),
  stripe_subscription_id TEXT NOT NULL CHECK (stripe_subscription_id ~ '^sub_[A-Za-z0-9]+$'),
  status TEXT NOT NULL CHECK (status IN ('incomplete', 'incomplete_expired', 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'paused')),
  product_name TEXT,
  price_nickname TEXT,
  quantity INTEGER CHECK (quantity IS NULL OR quantity >= 0),
  unit_amount BIGINT CHECK (unit_amount IS NULL OR unit_amount >= 0),
  currency TEXT CHECK (currency IS NULL OR currency ~ '^[a-z]{3}$'),
  billing_interval TEXT CHECK (billing_interval IS NULL OR billing_interval IN ('day', 'week', 'month', 'year')),
  interval_count INTEGER CHECK (interval_count IS NULL OR interval_count > 0),
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  trial_end TIMESTAMPTZ,
  cancel_at TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
  canceled_at TIMESTAMPTZ,
  latest_invoice_status TEXT,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (client_app_id, organization_id) REFERENCES client_apps(id, organization_id) ON DELETE CASCADE,
  UNIQUE (organization_id, stripe_subscription_id)
);
CREATE INDEX IF NOT EXISTS idx_client_subscriptions_app_status
  ON client_subscriptions (client_app_id, status, current_period_end DESC);

ALTER TABLE client_subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS client_subscriptions_member_read ON client_subscriptions;
CREATE POLICY client_subscriptions_member_read ON client_subscriptions FOR SELECT TO authenticated
USING (dashboard_is_org_member(organization_id));
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON client_subscriptions FROM authenticated, anon;
GRANT SELECT ON client_subscriptions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON client_subscriptions TO service_role;

CREATE OR REPLACE FUNCTION dashboard_link_client_stripe_customer(
  target_client_app_id UUID, target_stripe_customer_id TEXT
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE target_app client_apps%ROWTYPE; normalized_customer_id TEXT;
BEGIN
  SELECT * INTO target_app FROM client_apps WHERE id = target_client_app_id FOR UPDATE;
  IF NOT FOUND OR auth.uid() IS NULL OR NOT dashboard_is_org_member(target_app.organization_id) THEN RAISE EXCEPTION 'Client app not found'; END IF;
  normalized_customer_id := trim(COALESCE(target_stripe_customer_id, ''));
  IF normalized_customer_id !~ '^cus_[A-Za-z0-9]+$' OR char_length(normalized_customer_id) > 255 THEN RAISE EXCEPTION 'Invalid Stripe customer ID'; END IF;
  IF EXISTS (SELECT 1 FROM client_apps WHERE organization_id = target_app.organization_id AND stripe_customer_id = normalized_customer_id AND id <> target_client_app_id) THEN RAISE EXCEPTION 'Stripe customer is already linked'; END IF;
  IF target_app.stripe_customer_id IS DISTINCT FROM normalized_customer_id THEN
    DELETE FROM client_subscriptions WHERE client_app_id = target_client_app_id;
  END IF;
  UPDATE client_apps SET stripe_customer_id = normalized_customer_id, stripe_sync_status = 'pending',
    stripe_sync_failure_code = NULL, stripe_customer_email = NULL, stripe_customer_name = NULL,
    last_stripe_sync_at = NULL WHERE id = target_client_app_id;
  INSERT INTO audit_events (organization_id, actor_user_id, event_type, target_type, target_id, metadata)
  VALUES (target_app.organization_id, auth.uid(), 'client.stripe.linked', 'client_app', target_client_app_id::TEXT,
    jsonb_build_object('sync_status', 'pending'));
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
    stripe_sync_failure_code = NULL, last_stripe_sync_at = NOW() WHERE id = target_client_app_id;
  RETURN snapshot_count;
END; $$;

CREATE OR REPLACE FUNCTION service_fail_client_stripe_sync(target_client_app_id UUID, target_failure_code TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE sanitized_code TEXT;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service role required'; END IF;
  sanitized_code := CASE WHEN target_failure_code ~ '^[a-z0-9_.:-]{1,100}$' THEN target_failure_code ELSE 'stripe_sync_failed' END;
  UPDATE client_apps SET stripe_sync_status = 'failed', stripe_sync_failure_code = sanitized_code,
    last_stripe_sync_at = NOW() WHERE id = target_client_app_id AND stripe_customer_id IS NOT NULL;
END; $$;

REVOKE ALL ON FUNCTION dashboard_link_client_stripe_customer(UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION service_replace_client_subscriptions(UUID, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION service_fail_client_stripe_sync(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dashboard_link_client_stripe_customer(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION service_replace_client_subscriptions(UUID, TEXT, TEXT, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION service_fail_client_stripe_sync(UUID, TEXT) TO service_role;

COMMIT;
