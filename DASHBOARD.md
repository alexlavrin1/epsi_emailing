# EpsiFlow Dashboard Plan

## Product goal

Build a secure internal operations platform on top of the existing EpsiFlow engine. The dashboard will unify CRM activity, email conversations, outreach, payment recovery, tasks, approvals, automations, and operational health without rewriting the integrations that already work.

## Product areas

### Dashboard

The home screen should answer:

- What needs attention?
- What happened today?
- Are automations working?
- Which clients or prospects are moving forward?
- Which emails, payments, or workflows are failing?

Initial widgets:

- New replies
- Interested prospects
- Clients requiring follow-up
- Overdue payment-recovery cases
- Emails sent, replied, bounced, and unsubscribed
- Automation failures
- Tasks waiting for approval
- Recent activity

### CRM

Use one contact system with lifecycle stages for prospects, qualified leads, interested prospects, onboarding clients, active clients, at-risk clients, and inactive or suppressed contacts.

Each client page should contain:

- Contact and company information
- Lifecycle stage, owner, and priority
- Email conversation and outreach history
- Payment and recovery status
- Slack identity
- Notes and tasks
- Automation activity
- A chronological activity timeline

### Inbox and email activity

The MVP will show messages already recorded by the existing Yandex SMTP/IMAP engine. It will add a reply queue, conversation view, contact linking, compose/reply actions, reply classification, and controls to stop automation or change a CRM stage. Comprehensive mailbox mirroring can follow later.

### Automations and semi-automations

Begin with structured, versioned workflows rather than an unrestricted visual builder. Each workflow will define its trigger, conditions, steps, delays, approval requirements, stop conditions, owner, and active or paused status.

Supported modes:

- Automatic: execute without intervention
- Approval required: prepare an action and wait
- Draft only: prepare a proposed message or change
- Manual: show an operator checklist

The approval queue will support approve, edit, skip, and cancel actions.

### Observability and controls

Every workflow execution will record its trigger, workflow version, inputs, outputs, step results, errors, provider identifiers, approvals, retries, and timestamps.

Operator controls:

- Pause all automations
- Pause one workflow
- Cancel a pending action
- Retry a failed step
- Stop automation for one contact
- Configure sending limits
- Emergency email kill switch

## Security model

- Invite-only authentication
- Organization-based ownership of all business records
- Admin and operator roles
- Multi-factor authentication for administrators before production use
- Server-side authorization for every protected read and mutation
- Supabase Row Level Security based on organization membership
- Immutable audit events for sensitive actions
- Integration credentials kept server-side and encrypted at rest
- No Supabase service-role key or mailbox password in browser code

Foundation tables:

- `organizations`
- `user_profiles`
- `organization_members`
- `audit_events`
- `integration_connections`

Every CRM and automation record will ultimately carry an `organization_id`.

## Architecture

```text
Authenticated web platform
        |
Server-side application API
        |
Supabase + existing EpsiFlow engines
        |
Yandex / Stripe / Slack / Instantly
```

- Web application: React-based dashboard
- Database and authentication: Supabase
- Existing engine: preserved as background jobs and integration logic
- Application API: validates identity, organization membership, and permissions
- Scheduled workers: continue handling outreach and payment workflows
- Activity layer: supplies a unified timeline and dashboard metrics

## Planned data model additions

- `companies`
- `contacts`
- `crm_stage_history`
- `activities`
- `notes`
- `tasks`
- `email_conversations`
- `email_messages`
- `automation_definitions`
- `automation_versions`
- `automation_runs`
- `automation_step_runs`
- `approval_requests`
- `audit_events`

Existing `prospects` and `crm_customers` will initially be linked to the unified contact model and migrated incrementally.

## Delivery phases

### Phase 1 — Security and application foundation

- Create the frontend application
- Add Supabase authentication
- Add organizations, memberships, and roles
- Implement protected routes
- Establish server-side API boundaries
- Add audit logging
- Add and test Row Level Security policies

Outcome: only authorized organization members can access EpsiFlow data.

### Phase 2 — Read-only CRM and dashboard

Status: in progress. The read-only workspace now includes live dashboard metrics, an attention queue, unified prospect/client search, company grouping, a reply queue, per-contact outreach/payment timelines, a deterministic lifecycle pipeline, and Slack recovery-channel health. Contacts sharing an email are represented once in the pipeline; client and payment-risk states take precedence over outreach states. Manual lifecycle overrides remain for Phase 3 because they require audited write controls.

- Unified contacts and companies
- CRM pipeline
- Client detail page
- Email, Stripe, Slack, and outreach activity timeline
- Dashboard metrics
- Search and filtering
- Attention queue

Outcome: operators can understand client activity from one interface.

### Phase 3 — Safe operator actions

Status: in progress. The first slice is active: lifecycle overrides, internal notes, and follow-up tasks run through tenant-validated database functions. Every successful mutation appends an audit event in the same transaction; browser users retain read-only table policies and cannot write around those functions. Migration `007_safe_crm_operator_actions.sql` was applied and verified on 2026-08-21.

- Notes and tasks
- Lifecycle stage changes
- Pause and resume campaigns
- Stop outreach for a contact
- Compose and reply to email
- Retry approved failed operations
- Audit every action

Outcome: the platform becomes an operational CRM rather than only a reporting view.

### Phase 4 — Semi-automations

- Workflow definitions
- Triggers and conditions
- Approval queue
- Draft actions
- Delays and stop conditions
- Versioned templates
- Automation run history

Outcome: EpsiFlow prepares work while operators retain control over sensitive actions.

### Phase 5 — Full automations and monitoring

- Automatic low-risk workflows
- Idempotency and retries
- Failure alerts
- Health dashboard
- Volume and rate controls
- Emergency pause controls
- Conversion and performance reporting

Outcome: reliable automation with clear visibility and intervention controls.

### Phase 6 — Hardening

- MFA enforcement
- Permission and RLS tests
- Secret rotation process
- Data export and retention policies
- Backup and recovery tests
- Error monitoring
- Security review
- Responsive and accessibility QA

## MVP boundary

The first usable release includes secure login, a dashboard, contact/company CRM, client timeline, email reply queue, pipeline stages, notes and tasks, outreach and payment-recovery visibility, pause/stop controls, an approval queue, automation run logs, and an audit trail.

Deferred until the operating model is proven:

- Drag-and-drop automation builder
- AI reply generation
- Complete mailbox mirroring
- Client-facing accounts
- Advanced analytics

## Interface direction

Use a dense but calm operations interface with clear status colors, strong tables and timelines, minimal motion, keyboard-accessible controls, and prominent treatment of failures and actions awaiting approval.
