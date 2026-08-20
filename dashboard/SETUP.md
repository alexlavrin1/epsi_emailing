# Dashboard setup

## 1. Apply the security migration

Run `database/migrations/006_dashboard_security_foundation.sql` in the existing Supabase project after migrations 001–005.

## 2. Configure browser-safe authentication settings

Copy `.env.example` to `.env.local` inside `dashboard/` and fill in the Supabase project URL and anon/publishable key. Never use `SUPABASE_SERVICE_ROLE_KEY` in the dashboard environment.

In Supabase Auth settings:

- Disable public user registration.
- Create or invite the initial administrator.
- Require email confirmation.
- Configure short session lifetimes appropriate for an internal tool.
- Enable MFA for administrators before production use.

## 3. Provision the first organization

After creating the administrator in Supabase Auth, run the following in the SQL editor with that user's UUID:

```sql
WITH new_org AS (
  INSERT INTO organizations (name, slug)
  VALUES ('EpsiFlow', 'epsiflow')
  RETURNING id
)
INSERT INTO organization_members (organization_id, user_id, role)
SELECT id, 'REPLACE_WITH_AUTH_USER_UUID'::uuid, 'admin'
FROM new_org;
```

Then assign existing records to the organization. Review the target rows before running this backfill:

```sql
UPDATE mailboxes SET organization_id = (SELECT id FROM organizations WHERE slug = 'epsiflow') WHERE organization_id IS NULL;
UPDATE prospects SET organization_id = (SELECT id FROM organizations WHERE slug = 'epsiflow') WHERE organization_id IS NULL;
UPDATE campaigns SET organization_id = (SELECT id FROM organizations WHERE slug = 'epsiflow') WHERE organization_id IS NULL;
UPDATE crm_customers SET organization_id = (SELECT id FROM organizations WHERE slug = 'epsiflow') WHERE organization_id IS NULL;
UPDATE skipped_apollo_ids SET organization_id = (SELECT id FROM organizations WHERE slug = 'epsiflow') WHERE organization_id IS NULL;
UPDATE stripe_webhook_events SET organization_id = (SELECT id FROM organizations WHERE slug = 'epsiflow') WHERE organization_id IS NULL;
```

While the project has exactly one organization, new engine records inherit that organization automatically. If additional organizations are added, the database rejects unscoped writes until the engine supplies an explicit `organization_id`.

## 4. Run locally

From the `dashboard/` directory, run `npm run dev`. Unauthenticated visitors see the sign-in screen. Authenticated users without an active organization membership see an access-pending screen.
