-- EpsiFlow dashboard security foundation
-- Apply after migrations 001-005. Existing engine jobs continue to use the
-- service-role key and therefore bypass these browser-facing RLS policies.

CREATE TABLE IF NOT EXISTS organizations (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL CHECK (char_length(trim(name)) BETWEEN 1 AND 120),
  slug       TEXT UNIQUE NOT NULL CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_profiles (
  id           UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS organization_members (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role            TEXT NOT NULL CHECK (role IN ('admin', 'operator')),
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_organization_members_user
  ON organization_members (user_id, status);

CREATE TABLE IF NOT EXISTS integration_connections (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider        TEXT NOT NULL CHECK (provider IN ('yandex', 'stripe', 'slack', 'instantly', 'apollo')),
  label           TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled', 'error')),
  settings        JSONB NOT NULL DEFAULT '{}'::JSONB,
  secret_reference TEXT,
  last_checked_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, provider, label)
);

COMMENT ON COLUMN integration_connections.settings IS
  'Non-secret provider metadata only. Credentials belong in server-side secret storage.';

CREATE TABLE IF NOT EXISTS audit_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  actor_user_id   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  event_type      TEXT NOT NULL CHECK (char_length(event_type) BETWEEN 3 AND 120),
  target_type     TEXT,
  target_id       TEXT,
  request_id      TEXT,
  ip_address      INET,
  metadata        JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_events_org_created
  ON audit_events (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_actor_created
  ON audit_events (actor_user_id, created_at DESC);

-- Existing business records become tenant-aware without interrupting current
-- engine processing. Rows remain invisible to dashboard users until they are
-- explicitly assigned to an organization during bootstrap.
ALTER TABLE mailboxes ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE skipped_apollo_ids ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE stripe_webhook_events ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE crm_customers ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_mailboxes_organization ON mailboxes (organization_id);
CREATE INDEX IF NOT EXISTS idx_prospects_organization ON prospects (organization_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_organization ON campaigns (organization_id);
CREATE INDEX IF NOT EXISTS idx_crm_customers_organization ON crm_customers (organization_id);

-- Preserve the existing single-workspace engine without teaching every job
-- about tenancy at once. With exactly one organization, new top-level records
-- inherit it. If more organizations are added later, unscoped writes fail
-- closed and each engine call must provide an explicit organization_id.
CREATE OR REPLACE FUNCTION dashboard_assign_single_organization()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  organization_count INTEGER;
  only_organization_id UUID;
BEGIN
  IF NEW.organization_id IS NOT NULL THEN RETURN NEW; END IF;
  SELECT COUNT(*) INTO organization_count FROM organizations;
  SELECT id INTO only_organization_id FROM organizations ORDER BY created_at, id LIMIT 1;
  IF organization_count = 1 THEN
    NEW.organization_id = only_organization_id;
  ELSIF organization_count > 1 THEN
    RAISE EXCEPTION 'organization_id is required when more than one organization exists';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS mailboxes_assign_organization ON mailboxes;
CREATE TRIGGER mailboxes_assign_organization BEFORE INSERT ON mailboxes FOR EACH ROW EXECUTE FUNCTION dashboard_assign_single_organization();
DROP TRIGGER IF EXISTS prospects_assign_organization ON prospects;
CREATE TRIGGER prospects_assign_organization BEFORE INSERT ON prospects FOR EACH ROW EXECUTE FUNCTION dashboard_assign_single_organization();
DROP TRIGGER IF EXISTS campaigns_assign_organization ON campaigns;
CREATE TRIGGER campaigns_assign_organization BEFORE INSERT ON campaigns FOR EACH ROW EXECUTE FUNCTION dashboard_assign_single_organization();
DROP TRIGGER IF EXISTS skipped_apollo_assign_organization ON skipped_apollo_ids;
CREATE TRIGGER skipped_apollo_assign_organization BEFORE INSERT ON skipped_apollo_ids FOR EACH ROW EXECUTE FUNCTION dashboard_assign_single_organization();
DROP TRIGGER IF EXISTS stripe_events_assign_organization ON stripe_webhook_events;
CREATE TRIGGER stripe_events_assign_organization BEFORE INSERT ON stripe_webhook_events FOR EACH ROW EXECUTE FUNCTION dashboard_assign_single_organization();
DROP TRIGGER IF EXISTS crm_customers_assign_organization ON crm_customers;
CREATE TRIGGER crm_customers_assign_organization BEFORE INSERT ON crm_customers FOR EACH ROW EXECUTE FUNCTION dashboard_assign_single_organization();

CREATE OR REPLACE FUNCTION dashboard_is_org_member(target_organization_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM organization_members
    WHERE organization_id = target_organization_id
      AND user_id = auth.uid()
      AND status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION dashboard_has_org_role(target_organization_id UUID, allowed_roles TEXT[])
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM organization_members
    WHERE organization_id = target_organization_id
      AND user_id = auth.uid()
      AND status = 'active'
      AND role = ANY(allowed_roles)
  );
$$;

REVOKE ALL ON FUNCTION dashboard_is_org_member(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION dashboard_has_org_role(UUID, TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dashboard_is_org_member(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION dashboard_has_org_role(UUID, TEXT[]) TO authenticated;

CREATE OR REPLACE FUNCTION dashboard_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS organizations_touch_updated_at ON organizations;
CREATE TRIGGER organizations_touch_updated_at BEFORE UPDATE ON organizations
FOR EACH ROW EXECUTE FUNCTION dashboard_touch_updated_at();
DROP TRIGGER IF EXISTS user_profiles_touch_updated_at ON user_profiles;
CREATE TRIGGER user_profiles_touch_updated_at BEFORE UPDATE ON user_profiles
FOR EACH ROW EXECUTE FUNCTION dashboard_touch_updated_at();
DROP TRIGGER IF EXISTS organization_members_touch_updated_at ON organization_members;
CREATE TRIGGER organization_members_touch_updated_at BEFORE UPDATE ON organization_members
FOR EACH ROW EXECUTE FUNCTION dashboard_touch_updated_at();
DROP TRIGGER IF EXISTS integration_connections_touch_updated_at ON integration_connections;
CREATE TRIGGER integration_connections_touch_updated_at BEFORE UPDATE ON integration_connections
FOR EACH ROW EXECUTE FUNCTION dashboard_touch_updated_at();

CREATE OR REPLACE FUNCTION dashboard_create_profile_for_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO user_profiles (id, display_name)
  VALUES (NEW.id, NULLIF(trim(COALESCE(NEW.raw_user_meta_data->>'full_name', '')), ''))
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS dashboard_auth_user_created ON auth.users;
CREATE TRIGGER dashboard_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION dashboard_create_profile_for_user();

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS organizations_member_read ON organizations;
CREATE POLICY organizations_member_read ON organizations FOR SELECT TO authenticated
USING (dashboard_is_org_member(id));
DROP POLICY IF EXISTS organizations_admin_update ON organizations;
CREATE POLICY organizations_admin_update ON organizations FOR UPDATE TO authenticated
USING (dashboard_has_org_role(id, ARRAY['admin']))
WITH CHECK (dashboard_has_org_role(id, ARRAY['admin']));

DROP POLICY IF EXISTS profiles_self_read ON user_profiles;
CREATE POLICY profiles_self_read ON user_profiles FOR SELECT TO authenticated USING (id = auth.uid());
DROP POLICY IF EXISTS profiles_self_update ON user_profiles;
CREATE POLICY profiles_self_update ON user_profiles FOR UPDATE TO authenticated
USING (id = auth.uid()) WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS memberships_member_read ON organization_members;
CREATE POLICY memberships_member_read ON organization_members FOR SELECT TO authenticated
USING (user_id = auth.uid() OR dashboard_is_org_member(organization_id));
DROP POLICY IF EXISTS memberships_admin_insert ON organization_members;
CREATE POLICY memberships_admin_insert ON organization_members FOR INSERT TO authenticated
WITH CHECK (dashboard_has_org_role(organization_id, ARRAY['admin']));
DROP POLICY IF EXISTS memberships_admin_update ON organization_members;
CREATE POLICY memberships_admin_update ON organization_members FOR UPDATE TO authenticated
USING (dashboard_has_org_role(organization_id, ARRAY['admin']))
WITH CHECK (dashboard_has_org_role(organization_id, ARRAY['admin']));
DROP POLICY IF EXISTS memberships_admin_delete ON organization_members;
CREATE POLICY memberships_admin_delete ON organization_members FOR DELETE TO authenticated
USING (dashboard_has_org_role(organization_id, ARRAY['admin']));

DROP POLICY IF EXISTS integrations_admin_read ON integration_connections;
CREATE POLICY integrations_admin_read ON integration_connections FOR SELECT TO authenticated
USING (dashboard_has_org_role(organization_id, ARRAY['admin']));
DROP POLICY IF EXISTS integrations_admin_insert ON integration_connections;
CREATE POLICY integrations_admin_insert ON integration_connections FOR INSERT TO authenticated
WITH CHECK (dashboard_has_org_role(organization_id, ARRAY['admin']));
DROP POLICY IF EXISTS integrations_admin_update ON integration_connections;
CREATE POLICY integrations_admin_update ON integration_connections FOR UPDATE TO authenticated
USING (dashboard_has_org_role(organization_id, ARRAY['admin']))
WITH CHECK (dashboard_has_org_role(organization_id, ARRAY['admin']));
DROP POLICY IF EXISTS integrations_admin_delete ON integration_connections;
CREATE POLICY integrations_admin_delete ON integration_connections FOR DELETE TO authenticated
USING (dashboard_has_org_role(organization_id, ARRAY['admin']));

DROP POLICY IF EXISTS audit_member_read ON audit_events;
CREATE POLICY audit_member_read ON audit_events FOR SELECT TO authenticated
USING (dashboard_is_org_member(organization_id));
DROP POLICY IF EXISTS audit_actor_insert ON audit_events;
CREATE POLICY audit_actor_insert ON audit_events FOR INSERT TO authenticated
WITH CHECK (actor_user_id = auth.uid() AND dashboard_is_org_member(organization_id));
-- Deliberately no UPDATE or DELETE policy: audit events are append-only.

-- Read-only browser access for Phase 2. No authenticated write policies are
-- granted to business tables in Phase 1.
DROP POLICY IF EXISTS dashboard_mailboxes_read ON mailboxes;
CREATE POLICY dashboard_mailboxes_read ON mailboxes FOR SELECT TO authenticated USING (dashboard_is_org_member(organization_id));
DROP POLICY IF EXISTS dashboard_prospects_read ON prospects;
CREATE POLICY dashboard_prospects_read ON prospects FOR SELECT TO authenticated USING (dashboard_is_org_member(organization_id));
DROP POLICY IF EXISTS dashboard_campaigns_read ON campaigns;
CREATE POLICY dashboard_campaigns_read ON campaigns FOR SELECT TO authenticated USING (dashboard_is_org_member(organization_id));
DROP POLICY IF EXISTS dashboard_campaign_steps_read ON campaign_steps;
CREATE POLICY dashboard_campaign_steps_read ON campaign_steps FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM campaigns c WHERE c.id = campaign_id AND dashboard_is_org_member(c.organization_id)));
DROP POLICY IF EXISTS dashboard_outreach_sends_read ON outreach_sends;
CREATE POLICY dashboard_outreach_sends_read ON outreach_sends FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM campaigns c WHERE c.id = campaign_id AND dashboard_is_org_member(c.organization_id)));
DROP POLICY IF EXISTS dashboard_prospect_replies_read ON prospect_replies;
CREATE POLICY dashboard_prospect_replies_read ON prospect_replies FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM campaigns c WHERE c.id = campaign_id AND dashboard_is_org_member(c.organization_id)));
DROP POLICY IF EXISTS dashboard_skipped_apollo_read ON skipped_apollo_ids;
CREATE POLICY dashboard_skipped_apollo_read ON skipped_apollo_ids FOR SELECT TO authenticated USING (dashboard_is_org_member(organization_id));
DROP POLICY IF EXISTS dashboard_stripe_events_read ON stripe_webhook_events;
CREATE POLICY dashboard_stripe_events_read ON stripe_webhook_events FOR SELECT TO authenticated USING (dashboard_is_org_member(organization_id));
DROP POLICY IF EXISTS dashboard_crm_customers_read ON crm_customers;
CREATE POLICY dashboard_crm_customers_read ON crm_customers FOR SELECT TO authenticated USING (dashboard_is_org_member(organization_id));
DROP POLICY IF EXISTS dashboard_recovery_cases_read ON payment_recovery_cases;
CREATE POLICY dashboard_recovery_cases_read ON payment_recovery_cases FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM crm_customers c WHERE c.id = crm_customer_id AND dashboard_is_org_member(c.organization_id)));
DROP POLICY IF EXISTS dashboard_recovery_messages_read ON payment_recovery_messages;
CREATE POLICY dashboard_recovery_messages_read ON payment_recovery_messages FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM payment_recovery_cases r JOIN crm_customers c ON c.id = r.crm_customer_id WHERE r.id = recovery_case_id AND dashboard_is_org_member(c.organization_id)));
