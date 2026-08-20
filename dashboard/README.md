# EpsiFlow Dashboard

Secure internal control plane for the existing EpsiFlow outreach and client-operations engine.

Phase 1 provides:

- Invite-only Supabase authentication
- Protected server-rendered routes and API endpoints
- Organization membership and admin/operator roles
- Organization-scoped Row Level Security
- Append-only authentication audit events
- A responsive sign-in and protected application shell

See `SETUP.md` for database and authentication configuration. The broader product roadmap lives in the repository root at `DASHBOARD.md`.

## Commands

- `npm run dev` starts the local dashboard.
- `npm run build` creates the deployment build.
- `npm test` builds and verifies authentication and security boundaries.
- `npm run lint` runs the interface lint rules.
