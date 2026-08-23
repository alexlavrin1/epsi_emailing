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

## Playbook definition

Each playbook contains:

- Name and operator-facing purpose
- Channel: email or Slack
- Trigger: manual check-in initially; subscription-event triggers later
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
