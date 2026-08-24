# EpsiFlow Client-Success Playbooks

## Product goal

Turn reliable CRM and subscription signals into timely, reviewable client-success communication. EpsiFlow should help an operator decide who needs attention and prepare a useful message without allowing generated or templated text to leave the platform automatically.

## Operating model

```text
Client + subscription state
          ↓
Playbook eligibility and trigger
          ↓
Version-pinned email or Slack draft
          ↓
Human edits and decision
          ↓
Approved delivery through the relevant provider
```

The eligibility decision and delivery decision are deliberately separate. A matching subscription state may create a draft, but it never authorizes external delivery.

CRM relationship state is authoritative. Stripe is billing evidence and never silently turns client-success automation off. Each client is manually classified as EpsiFlow Direct or Stripe plan, and as active, churned, or closed. Active clients receive service/payment playbooks, churned clients receive reactivation playbooks, and closed clients have automation disabled.

Before an agent drafts, it must receive the full stored client context: client and contact facts, internal relationship notes, subscription history, and every synchronized email in chronological thread order. Slack links are included now, but Slack message history is unavailable until a separate history-sync integration is installed. Long histories must be summarized in auditable chunks without dropping unresolved commitments or the most recent conversation.

## Playbook definition

Each playbook contains:

- Name and operator-facing purpose
- Channel: email or Slack
- Trigger: manual check-in, scheduled check-in, Stripe cancellation, or churn reactivation
- CRM audience: EpsiFlow Direct or Stripe plan; active or churned relationships
- Eligible subscription states
- Versioned subject and body templates
- Cooldown and idempotency rules
- Active or paused status
- Required human approval

Initial template variables:

- `{{clientName}}`
- `{{contactName}}`
- `{{contactFirstName}}`
- `{{subscriptionStatus}}`
- `{{productName}}`
- `{{billingInterval}}`

## Example playbooks

### Advertising progress check-in

- Trigger: manual
- Eligible states: active or trialing
- Channel: email or Slack
- Purpose: ask how advertising performance is developing and whether the client needs support

### Trial support

- Trigger: subscription enters trialing
- Channel: email
- Purpose: make sure setup is complete and surface blockers before trial end

### Payment or retention attention

- Trigger: subscription becomes past due, unpaid, or cancellation is scheduled
- Channel: email or Slack
- Purpose: prepare a sensitive follow-up for review; never send automatically

### Renewal or success review

- Trigger: period end approaches for an active subscription
- Channel: email
- Purpose: prepare a results review or next-period planning message

### Churn reactivation

- Trigger: CRM relationship state is churned and the reactivation cooldown has elapsed
- Channel: email or Slack
- Purpose: learn why the client left, address the real objection, and offer a relevant smaller plan or return path

## Delivery slices

### Slice 1 — Manual approval-gated drafts

- Create versioned email or Slack playbooks
- Restrict playbooks by current subscription status
- Run a playbook from an existing-client page
- Pin every draft to the playbook version used
- Edit, approve, or cancel in the approval queue
- Keep approved drafts inert; no provider delivery exists in this slice
- Audit every configuration and draft decision

### Slice 2 — Approved email delivery

- Revalidate client, contact, playbook, and subscription context at send time
- Require an approved draft
- Send through the existing server-side Yandex integration
- Record provider identifiers and append the sent message to correspondence
- Apply per-client stops, rate limits, idempotency, retries, and the global kill switch

### Slice 3 — Approved Slack delivery

- Require an accessible, explicitly linked Slack channel
- Revalidate channel membership and app permission at send time
- Send as the EpsiFlow Slack app, never as the operator
- Preserve Slack thread context where selected
- Apply the controls recorded in `SLACK.md`

### Slice 4 — Event-created drafts

- Trigger from verified subscription state changes and CRM schedules
- Add cooldowns and deduplication
- Prepare drafts only when the playbook is active and conditions still match
- Surface runs and failures in automation monitoring
- Keep external delivery approval-gated by default

### Slice 5 — Context-aware drafting agent

Migration 032 implements the Slice 4 foundation for scheduled check-ins, Stripe cancellation follow-ups, and churn reactivation. The worker is disabled by default, runs before the weekend sending guard, deduplicates every trigger window, and prepares template drafts only. It snapshots how many synchronized emails were available.

Migration 033 implements the disabled-by-default Slice 5 agent queue. The bounded Vercel worker passes the complete stored client context through Vercel AI Gateway's OpenResponses endpoint to an OpenAI model with provider storage disabled, treats every customer-controlled field as untrusted evidence, requires strict structured output, validates cited message IDs against the client record, and stores only the reviewed draft, safe provider metadata, a context fingerprint, warnings, and source links. Oversized context is never silently truncated: the draft fails safely for a later summarization workflow. No provider delivery is added.

- Run as a bounded Vercel job over claimed draft requests
- Use the customer-support persona for triage, empathy, commitments, and escalation
- Use sales-enablement guidance for situation-specific retention and reactivation language
- Ground every draft in synchronized conversations and structured CRM/billing facts
- Store citations to source message IDs and surface missing context
- Never infer that a Stripe cancellation closes the CRM relationship
- Default to `openai/gpt-5.6-luna` with `medium` reasoning to balance drafting quality and cost
- Authenticate with Vercel's automatic short-lived `VERCEL_OIDC_TOKEN` in deployments, or a server-only `AI_GATEWAY_API_KEY` for local development
- Require `CLIENT_SUCCESS_AGENT_ENABLED=true`; otherwise no model request is made

Wise balance and top-up tracking is deferred until the core CRM automation, approvals, and delivery loop is operational.

### Slice 6 — EpsiFlow playbook library

Migration 034 installs four disabled-by-default, editable presets based on the product and sales context in `EPSIFLOW.md`:

- Monthly client health check — active EpsiFlow Direct and Stripe-plan clients, every 30 days
- EpsiFlow Direct monthly payment check — active Direct clients, every 30 days, with CRM relationship state authoritative over Stripe
- Stripe plan payment and cancellation recovery — active Stripe-plan clients in canceled, past-due, unpaid, incomplete, or expired states, every 14 days
- New lead education and onboarding — one draft 15 minutes after each eligible incoming lead reply

Each definition exposes its audience, cadence, fallback template, and exact playbook instruction passed to the AI. Administrators can pause a playbook and create a new immutable version with changed audience, cadence, wording, or AI instructions. The lead workflow reconstructs all stored sent campaign messages and inbound replies before drafting. Every preset starts as a draft, every generated message remains approval-gated, and this slice adds no automatic provider delivery.

### Slice 7 — persistent client assignments

Migration 036 changes the client-page picker from a one-time draft action into one persistent playbook assignment per client app. Re-selecting a playbook updates that assignment; existing one-shot choices are recovered from the latest client draft during migration.

The weekend-safe outreach cycle evaluates assigned playbooks after synchronizing mailbox history. It prepares a context-aware approval draft when the latest inbound email is unanswered, when an outbound email has received no reply for the assignment's follow-up interval, or when the relationship is due for periodic review. Default cadences are 15 minutes for replies, 5 days for lead follow-ups, 7 days for Direct/payment follow-ups, 14 days for lead and Stripe recovery reviews, and 30 days for Direct payment reviews. Exact source-message and time-window keys prevent duplicate drafts.

The lead education prompt now treats the latest unanswered message as the primary task and must answer every explicit request before offering a next step. It includes the confirmed EpsiFlow onboarding path and both known commercial routes. Because the current product record still lacks a confirmed Direct price and fee table, the model must identify those terms for human confirmation rather than inventing them.

## Safety rules

- No draft generation authorizes delivery.
- Approved drafts remain inert until the corresponding delivery slice is installed.
- Templates accept only allowlisted variables.
- Every server action validates tenant membership and record ownership.
- Browser users never write playbook or draft tables directly.
- Stored playbook versions are immutable; a later editing slice must create a new version instead of rewriting history.
- Subscription state is rechecked before draft creation and again before eventual delivery.
- Duplicate open drafts for the same playbook, client, contact, and channel are blocked.
- Sensitive message content follows the existing export and retention policy.
