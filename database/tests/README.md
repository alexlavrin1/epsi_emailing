# Database security regression checks

Run `001_dashboard_rls_regression.sql` as one complete query in the Supabase SQL Editor after applying migration 021.

The suite uses an existing active administrator membership and, when available, an active operator membership. It validates anonymous isolation, tenant isolation, administrator AAL2 enforcement, operator AAL1 access, direct-write revocations, and service-role-only worker functions.

All role and JWT changes are transaction-local. The suite ends with `ROLLBACK` and does not create, update, or delete production records. A successful run returns:

`EpsiFlow permission and RLS regression checks passed`
