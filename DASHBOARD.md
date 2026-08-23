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

Status: complete. The read-only workspace includes live dashboard metrics, an attention queue, unified prospect/client search, company grouping, a reply queue, per-contact outreach/payment timelines, a deterministic lifecycle pipeline, and Slack recovery-channel health. Contacts sharing an email are represented once in the pipeline; client and payment-risk states take precedence over outreach states.

- Unified contacts and companies
- CRM pipeline
- Client detail page
- Email, Stripe, Slack, and outreach activity timeline
- Dashboard metrics
- Search and filtering
- Attention queue

Outcome: operators can understand client activity from one interface.

### Phase 3 — Safe operator actions

Status: complete. Lifecycle overrides, internal notes, follow-up tasks, guarded campaign pause/resume, and contact-level outreach stops are active through tenant-validated database functions. Every successful mutation appends an audit event in the same transaction; browser users retain read-only table policies and cannot write around those functions. Migrations `007_safe_crm_operator_actions.sql` and `008_safe_outreach_controls.sql` were applied and verified on 2026-08-21.

The third slice adds approval-gated manual email replies and controlled recovery-delivery retries. Drafts are inert until explicitly approved; approved work is atomically claimed and executed by the server-side engine, which retains provider credentials and existing recipient/payment safeguards. Migration `009_approved_replies_and_retries.sql` was applied and verified on 2026-08-21. Anonymous mutation attempts are denied, the backend queue claim is available, and authenticated mailbox reads are restricted to non-secret columns.

The final slice adds a tenant-scoped, read-only audit-log dashboard with action, category, and time filters; exact timestamps; safe expandable metadata; and links back to affected records. Audit metadata is rendered through an explicit allowlist so future event payloads cannot accidentally expose credentials or unrestricted message content. Migration `010_lock_audit_log_writes.sql` removes direct browser inserts so only guarded server-side actions can append history; it was applied and verified on 2026-08-21.

- Notes and tasks
- Lifecycle stage changes
- Pause and resume campaigns
- Stop outreach for a contact
- Compose and reply to email
- Retry approved failed operations
- Audit every action

Outcome: the platform becomes an operational CRM rather than only a reporting view.

### Phase 4 — Semi-automations

Status: complete. The first slice adds a structured incoming-reply workflow: administrators can create versioned templates, configure a delay, activate or pause one reply trigger, and observe version-pinned run history. New eligible replies prepare inert drafts through the backend worker; operators can edit and approve those drafts, and the existing delivery worker sends only after approval. Runs recheck workflow and prospect state before preparing work. Migrations `011_reply_draft_automations.sql` and `012_lock_automation_worker_functions.sql` were applied and verified on 2026-08-22. Browser roles cannot invoke worker functions; backend enqueue and atomic claim access remains active.

The second slice adds explicit skip and cancel dispositions to the approval queue. Both close the draft without delivery, record distinct stopped or cancelled automation outcomes, and append tenant-scoped audit history through guarded database functions. Migration `013_approval_dispositions.sql` was applied and verified on 2026-08-22.

- Workflow definitions
- Triggers and conditions
- Approval queue
- Draft actions
- Delays and stop conditions
- Versioned templates
- Automation run history

Outcome: EpsiFlow prepares work while operators retain control over sensitive actions.

### Phase 5 — Full automations and monitoring

Status: complete. The first slice adds an organization-wide emergency pause with an explicit administrator reason, clear runtime-state visibility, and audit history. Database enforcement blocks new automation runs, queued run claims, draft completion, and delivery claims for automation-generated replies while preserving manual replies. Existing behavior remains enabled by default, and queued work resumes on the next worker cycle after the pause is lifted. Migration `014_automation_runtime_controls.sql` was applied and verified on 2026-08-22.

The second slice records tenant-scoped outreach-worker heartbeats from both Vercel cron and the local scheduler. The Automations dashboard shows the latest cycle, last success, 24-hour failure count, and stale state. Only sanitized failure codes are stored; monitoring remains best-effort and cannot prevent the outreach cycle from running. Migration `015_automation_worker_heartbeats.sql` was applied and verified on 2026-08-22.

The third slice adds an organization-wide rolling hourly limit for new automation runs. Enforcement is atomic under concurrent triggers, fails closed when runtime configuration is missing, and records both administrator limit changes and blocked triggers in the audit log. The dashboard shows current one-hour usage, the configured cap, and the number of blocked triggers in the last 24 hours. Migration `016_automation_rate_limits.sql` was applied and verified on 2026-08-22.

The fourth slice adds tenant-scoped failure alerts for automation runs and monitored worker cycles. Database triggers deduplicate alerts at the failure source, store only sanitized failure codes, and seed recent failures from the previous 30 days. Operators can acknowledge alerts without retrying or modifying failed work, and every acknowledgement remains visible in the append-only audit log. Migration `017_automation_failure_alerts.sql` was applied and verified on 2026-08-22.

The fifth slice adds privacy-preserving automation performance reporting for selectable 7-day and 30-day periods. A membership-guarded aggregate function returns trigger, draft, approval, delivery, decline, failure, active-run, and average-success-time metrics without exposing message content, recipients, or provider errors. The dashboard presents exact KPI values and a text-labelled outcome funnel. Migration `018_automation_performance_reporting.sql` was applied and verified on 2026-08-22.

The sixth slice adds guarded retries for failed draft-preparation runs. Operators can requeue the same version-pinned run up to three times after the database rechecks membership, workflow state, the global runtime, reply provenance, and prospect eligibility. Runs that already created a reply remain routed through the approval queue, preventing duplicate drafts and deliveries. Retry actions clear the active failure alert, retain repeated-failure reopening, and append audit history. Migration `019_automation_run_retries.sql` was applied and verified on 2026-08-22.

The seventh slice adds the first fully automatic low-risk action: a disabled-by-default rule that creates one assigned internal CRM follow-up task for each eligible new prospect reply. It never sends externally or changes prospect status, respects the organization-wide runtime pause, validates the assignee's active membership, remains idempotent under duplicate reply processing, and records configuration changes plus created tasks in the audit log. Migration `020_automatic_reply_followup_tasks.sql` was applied and verified on 2026-08-22.

- Automatic low-risk workflows
- Idempotency and retries
- Failure alerts
- Health dashboard
- Volume and rate controls
- Emergency pause controls
- Conversion and performance reporting

Outcome: reliable automation with clear visibility and intervention controls.

### Phase 6 — Hardening

Status: complete. The first slice requires Supabase authenticator MFA for every administrator session before client or automation data can be read or mutated. New administrators receive an in-product TOTP enrollment flow; returning administrators complete a six-digit challenge after password login. Enforcement exists at both the application boundary and the database membership/role helpers, while operators retain password-only access. Migration `021_admin_mfa_enforcement.sql` was applied and the live enrollment/challenge flow was verified on 2026-08-22.

The second slice adds a rollback-only production permission and RLS regression suite. It impersonates Supabase browser roles with transaction-local JWT claims and checks anonymous isolation, AAL1/AAL2 administrator behavior, operator access, cross-tenant visibility, direct-write revocations, and service-role-only worker functions without changing production records. `database/tests/001_dashboard_rls_regression.sql` passed against production on 2026-08-22.

The third slice adds a provider-by-provider secret-rotation and exposure-response runbook, a complete sanitized server environment template, and a read-only `npm run secrets:check` audit. The audit validates server-key shape, minimum cron-secret length, feature-dependent credentials, browser exposure, ignored local environment files, and recognizable live credentials in tracked files without printing secret values.

The fourth slice adds an AAL2 administrator-only organization JSON export and disabled-by-default retention policy previews. Exports use the authenticated tenant RLS session, exclude unrestricted audit metadata, declare per-dataset limits, disable response caching, and must append an audit event before download. Administrators can tune draft retention periods and preview eligible row counts, but no deletion executor exists or runs in this slice. Migration `022_data_governance_foundation.sql` was applied and the live export/audit flow was verified on 2026-08-22.

The fifth slice adds backup and recovery verification without automating destructive restoration. A read-only export validator checks schema version, dataset caps, duplicate IDs, contact/recovery references, audit metadata, forbidden secret fields, and file integrity while printing only aggregate counts and a SHA-256 checksum. The first live export passed with no truncation and owner-only file permissions on 2026-08-22. A rollback-only SQL suite validates critical schema, RLS, worker privileges, memberships, relationships, and retention seeds in a separately restored Supabase project. The recovery runbook separates database backups, organization exports, deployment configuration, and provider credentials, with provisional 24-hour RPO and four-hour RTO targets pending a timed clone drill.

The sixth slice adds privacy-safe production error monitoring for dashboard render failures, outreach cron failures, payment-recovery cron failures, and Stripe webhook ingestion failures. Repeated failures are deduplicated by fixed source fingerprints, counted, and reopened after recurrence; only sanitized codes are stored. Operators can acknowledge issues without changing failed work, and acknowledgement is audited. Raw exceptions remain in restricted Vercel logs and are never copied into the dashboard database. Migration `023_production_error_monitoring.sql` was applied and the live healthy-state view was verified on 2026-08-22.

The seventh slice addresses findings from the final security review: explicit CSP, anti-framing, MIME-sniffing, referrer, browser-permission, DNS-prefetch, and HSTS headers; same-origin POST-only sensitive exports; guarded authentication audit events that work with the append-only audit policy; generic outreach 500 responses; and a patched transitive HTML parsing dependency. Migration `024_guarded_auth_audit.sql` was applied on 2026-08-22. The production sign-in and protected-route responses expose the reviewed security headers, the export endpoint rejects GET, cross-origin POST, and unauthenticated same-origin POST requests, and the authenticated sign-in, sign-out, MFA, and export audit events were confirmed in production.

The eighth slice completes responsive and accessibility QA. The final pass keeps every dashboard destination and sign-out reachable on phones, gives interactive controls at least 44px targets, increases supporting mobile text, retains visible keyboard focus and reduced-motion behavior, and adds regression coverage for those guarantees. The optimized dashboard build, accessibility-enabled lint, 31 rendered dashboard checks, 67 engine tests, and both production dependency audits pass with zero known vulnerabilities. The deployed phone layout and horizontally scrollable navigation were verified in production on 2026-08-22. The optional billable recovery-clone drill remains explicitly deferred and does not block the internal MVP.

- MFA enforcement
- Permission and RLS tests
- Secret rotation process
- Data export and retention policies
- Backup and recovery tests
- Error monitoring
- Security review
- Responsive and accessibility QA

### Phase 7 — Existing-client workspace

Status: in progress. The first slice adds a tenant-scoped Clients workspace organized by app, with a validated website and any number of named contacts. Contact emails are deterministically unique inside the organization so the server-side Yandex IMAP worker can match recent INBOX and Sent correspondence without exposing mailbox credentials to the dashboard. Optional Slack names queue a server-side lookup by email with an exact-name fallback; the bot opens and records a direct conversation but does not post a message. Client creation, contact creation, and Slack assignment are guarded and audited, while client apps, contacts, and correspondence are included in versioned organization exports and the disabled-by-default email retention preview. Migration `025_existing_client_workspace.sql` was applied on 2026-08-22. The second slice groups matched correspondence into expandable conversations using one-way hashes derived from standard email threading headers; migration `026_client_email_threads.sql` was applied on 2026-08-23. Initial client/contact sync now searches two years by exact address while recurring sync retains the shorter 90-day window. Slack Connect conversations can be linked with a validated Slack URL through audited migration `027_slack_connect_links.sql`.

- Client app registry and website links
- Multiple contacts per app
- Automatic email correspondence matching
- Expandable correspondence grouped by email thread
- Immediate client-only mailbox and Slack sync after client/contact changes
- Two-year exact-address historical search for new contacts
- Direct links to existing Slack Connect conversations
- Explicit Slack direct-chat assignment
- Tenant isolation, auditing, export, and retention coverage

### Phase 8 — Stripe subscriptions and client-success playbooks

Status: in progress. The first slice adds an explicit, audited Stripe customer link to each existing-client app and an immediate, server-side subscription refresh. The client workspace displays the current and historical subscription status, product and price, billing interval, period end, trial and cancellation state, and latest invoice status without exposing Stripe credentials or allowing subscription mutations. Migration `028_client_stripe_subscriptions.sql` was applied on 2026-08-23. The second slice refreshes linked clients immediately from verified Stripe invoice and subscription events and adds an atomic, bounded six-hour reconciliation fallback to the existing payment-recovery cron. Failed refreshes retain sanitized status on the client while successful refreshes replace the snapshot transactionally. Migration `029_client_subscription_reconciliation.sql` is ready to apply. Subscription state and CRM context can next trigger versioned playbooks that prepare email or Slack drafts. External communication remains approval-gated by default.

- Reviewable client-to-Stripe customer linking
- Current subscription, product, price, billing period, cancellation, trial, and payment-state visibility
- Verified webhook updates plus scheduled and on-demand reconciliation
- Subscription-state and CRM-event triggers
- Versioned client-success playbooks with configurable conditions and cooldowns
- Approval-gated email and Slack drafts
- Per-client communication preferences and stop controls
- Idempotency, rate limits, audit history, and runtime monitoring
- Safe manual prompts such as checking campaign or advertising progress

Outcome: operators can understand each client's commercial state and use reusable playbooks to prepare timely, contextual follow-ups without allowing generated text to send autonomously.

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
