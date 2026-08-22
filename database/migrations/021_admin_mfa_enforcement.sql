-- Require a Supabase AAL2 session whenever an administrator reads or mutates
-- tenant data. Operators retain password-only access. Organization identity is
-- kept readable so the application can determine that an admin needs MFA.

CREATE OR REPLACE FUNCTION dashboard_is_org_member(target_organization_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM organization_members
    WHERE organization_id = target_organization_id
      AND user_id = auth.uid()
      AND status = 'active'
      AND (role <> 'admin' OR COALESCE(auth.jwt() ->> 'aal', 'aal1') = 'aal2')
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
    SELECT 1
    FROM organization_members
    WHERE organization_id = target_organization_id
      AND user_id = auth.uid()
      AND status = 'active'
      AND role = ANY(allowed_roles)
      AND (role <> 'admin' OR COALESCE(auth.jwt() ->> 'aal', 'aal1') = 'aal2')
  );
$$;

DROP POLICY IF EXISTS organizations_member_read ON organizations;
CREATE POLICY organizations_member_read ON organizations FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM organization_members
    WHERE organization_id = organizations.id
      AND user_id = auth.uid()
      AND status = 'active'
  )
);

REVOKE ALL ON FUNCTION dashboard_is_org_member(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION dashboard_has_org_role(UUID, TEXT[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION dashboard_is_org_member(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION dashboard_has_org_role(UUID, TEXT[]) TO authenticated;
