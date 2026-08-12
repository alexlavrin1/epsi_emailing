# EpsiFlow Stripe CRM Automation

Status: Phase 1 complete — full sandbox 3DS recovery lifecycle validated.

Owner: EpsiFlow

Last updated: 2026-08-11

## Objective

Extend the existing acquisition engine into a reusable CRM automation engine. The first workflow will recover Stripe payments that require customer action, especially 3D Secure authentication.

The engine will identify the affected customer, send the secure Stripe-hosted invoice link by transactional email, optionally send a Slack message, stop reminders as soon as payment succeeds, and retain an auditable history in Supabase.

This project will not rely on Stripe's built-in customer email automation. Stripe remains the payment source of truth, while EpsiFlow owns notification policy and delivery so the same CRM foundation can support other automations later.

## Key Stripe distinction

`incomplete` is normally a subscription status, not an invoice status. In a typical 3DS case:

- PaymentIntent: `requires_action`
- Invoice: `open`
- Subscription: `incomplete`

The primary trigger must therefore be `invoice.payment_action_required`, followed by a fresh read of the invoice and customer. We must not notify every subscription merely because its status is `incomplete`.

The customer should receive Stripe's `hosted_invoice_url`. The engine must never handle or transmit card details.

## Agreed architecture

```text
Stripe webhook
      |
      v
Verify signature and retrieve current invoice state
      |
      v
Create/update recovery case in Supabase
      |
      v
Queue transactional email and optional Slack message
      |
      v
Yandex SMTP / Slack bot
      |
      v
invoice.paid closes the case and cancels reminders
```

A scheduled reconciliation job will periodically query Stripe to recover missed events and cancel stale jobs. Webhooks are the primary trigger; polling is the safety net.

## Separation from acquisition

Payment recovery must be a separate workflow, proposed under `src/payment-recovery/` or `src/crm/`.

It may reuse low-level email transport, logging, Supabase, and cron infrastructure, but it must not inherit:

- Cold-outreach daily limits.
- Prospect campaign state.
- Cold-email unsubscribe headers.
- Outreach business-hour rules unless explicitly configured.
- Campaign reply detection or prospect suppression.

Payment messages are transactional service communications and need their own templates, audit trail, controls, and delivery rules.

## Delivery phases

### Phase 1 — Stripe discovery and sandbox validation

Status: Complete on 2026-08-11

Goals:

- Determine whether the relevant payments are subscription invoices, one-off invoices, or both.
- Inspect representative 3DS-required payments in Stripe sandbox.
- Confirm affected finalized invoices expose `hosted_invoice_url`.
- Confirm customer name and email availability.
- Record the Stripe account API version.
- Trigger a sandbox 3DS flow and capture the actual event sequence.
- Confirm which terminal events close a recovery case.

Repository findings completed on 2026-08-11:

- Node.js/CommonJS application deployed through Vercel functions and cron.
- Supabase is the canonical state database.
- Yandex SMTP/IMAP provides existing email delivery and archiving.
- No Stripe SDK is currently installed.
- No Stripe CLI is currently available locally.
- No Stripe environment variables currently exist in `.env.local`.
- `.env` and `.env.local` are correctly ignored by Git.

Phase 1 access notes:

- A Stripe sandbox restricted API key is stored locally as `STRIPE_RESTRICTED_KEY` in `.env.local`; its `rk_test_` prefix and read access were validated on 2026-08-11. Do not paste it into chat or commit it.
- Temporary sandbox write access was used only to create labelled test fixtures. Reduce the key back to read-only after Phase 1.
- The webhook signing secret is not needed for read-only discovery, but will be required in Phase 2.

Phase 1 evidence to record before completion:

| Evidence | Result |
|---|---|
| Billing type: subscription, invoice, or both | Subscription-generated invoice path validated; live scope still to confirm |
| Stripe API version | `2022-11-15` |
| Example subscription ID | `sub_1U3CMvAe3OxHSCAxGyBPRVzS` |
| Example invoice ID | `in_1U3CMvAe3OxHSCAxJCTbWc9d` |
| PaymentIntent status | Observed `requires_action`, then `succeeded` |
| Invoice status | Observed `open`, then `paid` |
| `hosted_invoice_url` present | Yes |
| Customer email present | Yes |
| Actual event sequence | Captured below, including action required and paid terminal events |
| Time from action-required event to paid event | Approximately 10 seconds in the completed test |

Read-only sandbox inventory on 2026-08-11:

- Restricted sandbox key successfully authenticated.
- Customers: 0.
- Subscriptions: 0.
- Invoices: 0.
- Incomplete subscriptions: 0.
- Open invoices: 0.
- `invoice.payment_action_required` events: 0.
- Existing events are account/capability setup events only; there is no billing lifecycle to inspect yet.
- No Stripe object was created, updated, or deleted during discovery.

Sandbox 3DS fixture created on 2026-08-11:

- Product: `prod_V3Iy3fcI6si17S`.
- Recurring price: `price_1U3CMuAe3OxHSCAxmd2zRyRy` (USD 1.00/month).
- Test customer: `cus_V3IyWfrIIk7oqn` using a non-deliverable example email.
- Target subscription: `sub_1U3CNMAe3OxHSCAxNyhXxaQm`.
- Target invoice: `in_1U3CNMAe3OxHSCAxc5VZjibX`.
- Target PaymentIntent: `pi_3U3CNNAe3OxHSCAx0pyQZBLN`.
- All objects are sandbox-only and labelled for Phase 1 discovery.

Observed target event sequence:

1. `payment_intent.created`.
2. `customer.subscription.created` with subscription status `incomplete`.
3. `invoice.finalized` with invoice status `open`.
4. `invoice.created`.
5. `invoice.payment_action_required`.
6. `invoice.payment_failed` at the same timestamp.
7. `payment_intent.requires_action`.

Completed 3DS lifecycle observed on the first labelled fixture:

- Subscription: `sub_1U3CMvAe3OxHSCAxGyBPRVzS`.
- Invoice: `in_1U3CMvAe3OxHSCAxJCTbWc9d`.
- PaymentIntent: `pi_3U3CMwAe3OxHSCAx0JX4nr6X`.
- The Hosted Invoice Page initiated a test-card payment attempt.
- Stripe emitted `invoice.payment_action_required`, `invoice.payment_failed`, and `payment_intent.requires_action` for the same authentication requirement.
- Successful completion of the simulated 3DS challenge changed the PaymentIntent to `succeeded` and invoice to `paid`.
- Stripe changed the subscription from `incomplete` to `active`.
- Terminal events included `payment_intent.succeeded`, `customer.subscription.updated`, `invoice.payment_succeeded`, and `invoice.paid`.
- `invoice.payment_action_required` occurred approximately 10 seconds before `invoice.paid` in this test.

Terminal-state conclusion:

- Use `invoice.paid` as the primary successful terminal event for a recovery case.
- Also re-read the invoice before every scheduled notification because `invoice.payment_succeeded`, `payment_intent.succeeded`, and subscription updates can arrive in close succession and event ordering is not guaranteed.
- A recovery case is resolved when the canonical invoice is `paid` or has `amount_remaining = 0`; queued email and Slack notifications must then be cancelled.
- The full sandbox lifecycle required by the Phase 1 completion criteria has been observed without any live-mode operation.

Classification conclusion:

- `invoice.payment_action_required` is the primary recovery trigger.
- `invoice.payment_failed` can describe the same attempt and must not independently create a second recovery notification.
- Deduplication should be by Stripe invoice/recovery state as well as by event ID.
- Before delivery, retrieve current invoice and PaymentIntent state and require `invoice.status = open`, `amount_remaining > 0`, and `payment_intent.status = requires_action`.
- The finalized invoice includes both `customer_email` and `hosted_invoice_url`, so the planned transactional email path is viable.

Fixture nuance:

- An initial fixture using `payment_behavior=default_incomplete` produced an open invoice and hosted URL but left its PaymentIntent at `requires_confirmation` because no payment attempt occurred.
- The target fixture uses `payment_behavior=allow_incomplete`, which attempted payment and produced the actual `requires_action` lifecycle relevant to recovery automation.
- The second target fixture remains sandbox-only and open so it can be reused during Phase 2 webhook testing or allowed to expire naturally.

Phase 1 completion criteria:

- At least one complete sandbox 3DS-required payment lifecycle has been observed.
- The exact Stripe objects and fields needed by the engine are documented.
- The trigger, revalidation rules, and terminal events are confirmed against the account's actual API version.
- No live customer is contacted and no live payment is changed.

### Phase 2 — Stripe event ingestion

Status: Complete — implemented, deployed, and verified end-to-end on 2026-08-12.

- Install and pin the official Stripe Node SDK.
- Add `STRIPE_RESTRICTED_KEY`, `STRIPE_WEBHOOK_SECRET`, and disabled-by-default feature flags.
- Add `POST /api/webhooks/stripe` with raw-body signature verification.
- Subscribe only to required event types.
- Deduplicate Stripe event IDs in Supabase.
- Acknowledge valid events quickly and process delivery asynchronously.
- Re-read canonical Stripe state instead of trusting event order.

Initial event set:

- `invoice.payment_action_required`: open or update a recovery case.
- `invoice.paid`: resolve the case and cancel reminders.
- `invoice.payment_failed`: classify separately from a 3DS-required payment.
- `invoice.voided`: close the case.
- `customer.subscription.updated`: detect `incomplete_expired` and other terminal states.
- `customer.subscription.deleted`: close applicable cases.

Implemented Phase 2 components:

- Official Stripe Node SDK `22.5.0` installed and locked.
- `api/webhooks/stripe.js` accepts POST requests only and disables body parsing so the official SDK can verify the exact request bytes.
- Webhook payloads are limited to 1 MB.
- Missing and invalid Stripe signatures return `400` without queueing anything.
- Only the six event types above are accepted for storage; unrelated valid events return `200` and are ignored.
- Live events return `200` and are ignored while `STRIPE_ALLOW_LIVE_EVENTS=false`.
- All event ingestion returns `200` without storage while `STRIPE_EVENT_INGESTION_ENABLED=false`.
- `database/migrations/002_stripe_webhook_events.sql` defines the event ledger with the Stripe event ID as its primary key.
- Duplicate Stripe deliveries are treated as successful duplicates rather than creating a second job.
- Only event/object/customer identifiers, timestamps, event type, API version, and processing state are stored. Full Stripe customer payloads are not persisted.
- Stored events start at `pending`; a later worker will re-fetch canonical Stripe state before acting.
- The endpoint requires the Supabase service-role key whenever ingestion is enabled.

Phase 2 configuration defaults:

```text
STRIPE_API_VERSION=2022-11-15
STRIPE_WEBHOOK_SECRET=
STRIPE_EVENT_INGESTION_ENABLED=false
STRIPE_PAYMENT_RECOVERY_ENABLED=false
STRIPE_ALLOW_LIVE_EVENTS=false
```

External activation checklist:

1. Apply `database/migrations/002_stripe_webhook_events.sql` to Supabase. The table is not yet present remotely as of 2026-08-11.
2. Deploy the current code so `/api/webhooks/stripe` has a public HTTPS URL.
3. In the Stripe sandbox, create a webhook/event destination pointing to that URL.
4. Subscribe only to the six Phase 2 event types listed above.
5. Store that sandbox endpoint's `whsec_...` signing secret as `STRIPE_WEBHOOK_SECRET` locally and in the deployment secret store.
6. Keep `STRIPE_ALLOW_LIVE_EVENTS=false` and `STRIPE_PAYMENT_RECOVERY_ENABLED=false`.
7. Set `STRIPE_EVENT_INGESTION_ENABLED=true` only after the migration and signing secret are present.
8. Resend the existing sandbox `invoice.payment_action_required` event and confirm exactly one `pending` ledger row.
9. Resend the same event again and confirm it is reported as a duplicate with no second row.

Production activation verified on 2026-08-12:

- Supabase migration is applied and schema-compatible.
- Production endpoint: `https://epsi-emailing.vercel.app/api/webhooks/stripe`.
- Production loads both the restricted sandbox API key and webhook signing secret.
- An unsigned request is rejected with `400 Missing Stripe signature`.
- The real sandbox event `evt_1U3CUhAe3OxHSCAxPhWoosW1` (`invoice.payment_action_required`) was submitted with a valid endpoint signature and returned `queued`.
- Supabase stored one `pending` row for invoice `in_1U3CMvAe3OxHSCAxJCTbWc9d` with `livemode=false`.
- Re-delivery of the same event returned `duplicate` and the ledger remained at exactly one matching row.
- `STRIPE_PAYMENT_RECOVERY_ENABLED=false` and `STRIPE_ALLOW_LIVE_EVENTS=false`; no customer notification or live processing occurred.
- Stripe's current SDK warns that account API version `2022-11-15` is older than the latest available version. The integration remains deliberately pinned to the account version validated in Phase 1; an API-version upgrade should be handled as a separate tested change.

Phase 2 verification completed locally:

- The webhook module and deployed-handler shape load correctly under CommonJS.
- Vercel body parsing is disabled for the endpoint.
- Automated tests cover byte-exact body reading, size limits, minimal metadata extraction, valid queueing, duplicate handling, event filtering, disabled ingestion, live-event blocking, and invalid signatures.
- No email, Slack message, payment mutation, or live Stripe operation is enabled by Phase 2.

### Phase 3 — CRM data model

Status: Complete — implemented and verified against Supabase on 2026-08-12.

Proposed tables:

#### `crm_customers`

- Stripe customer ID.
- Email and name.
- Slack workspace and user IDs.
- Preferred channels and notification status.

#### `payment_recovery_cases`

- Unique Stripe invoice ID.
- Stripe customer and subscription IDs.
- Invoice and payment state.
- Amount and currency.
- Hosted invoice URL.
- Opened, next-reminder, and resolved timestamps.
- Recovery state and terminal reason.

#### `payment_recovery_messages`

- Recovery case ID.
- Channel: email or Slack.
- Reminder step.
- Queued, sending, sent, failed, or cancelled state.
- Provider message ID, error, and timestamps.
- Unique case/channel/step constraint to prevent duplicates.

#### `stripe_webhook_events`

- Unique Stripe event ID.
- Event type.
- Received and processed timestamps.
- Processing result and sanitized error.

Implemented Phase 3 components:

- `database/migrations/003_crm_payment_recovery.sql` creates the three Phase 3 tables with RLS enabled and no client policies.
- `crm_customers` uses the Stripe customer ID as its unique external identity and stores optional, explicit Slack workspace/user mappings.
- Slack workspace and user IDs must either both be present or both be absent; a mapped Slack identity can belong to only one CRM customer.
- Customer channel preferences are independent (`email_enabled` and `slack_enabled`) and the entire CRM customer can be suppressed.
- `payment_recovery_cases` permits exactly one recovery lifecycle per Stripe invoice.
- A case stores the canonical Stripe subscription and PaymentIntent IDs, invoice/payment states, amount remaining, currency, hosted invoice URL, latest source-event time, reminder time, and resolution evidence.
- Open cases require `resolved_at` to be null; terminal cases require a resolution timestamp.
- `payment_recovery_messages` permits one job per recovery case, channel, and step, preventing duplicate reminders across webhook retries.
- Message jobs have explicit `queued`, `sending`, `sent`, `failed`, and `cancelled` states with attempt and provider audit fields.
- The `claim_payment_recovery_message` database function atomically moves a queued/failed job to `sending` and increments its attempt count, preventing concurrent workers from both claiming it.
- Application access methods cover customer upsert/lookup, explicit Slack mapping, case upsert/lookup, idempotent job scheduling, due-job selection, atomic claiming, sent/failed outcomes, and cancellation.
- Pure record builders normalize email/currency, derive paid/void/expired/cancelled case outcomes from canonical Stripe state, reject negative amounts, and refuse to create an open recovery case without a Hosted Invoice Page.

Phase 3 safety boundary:

- Phase 3 does not consume the pending Stripe event, retrieve customer data automatically, or schedule/send any notification.
- The existing Phase 2 row remains `pending` until the event-processing phase is explicitly implemented.
- Full Stripe payloads and card/payment-method details are not stored in the CRM tables.
- Hosted Invoice Page URLs are server-side CRM data protected by RLS and must never be written to logs.

Phase 3 activation checklist:

1. Apply `database/migrations/003_crm_payment_recovery.sql` in the Supabase SQL editor.
2. Verify all three tables and the atomic claim function exist.
3. Run database constraint checks using synthetic records inside a transaction that is rolled back.
4. Deploy the Phase 3 code only after the migration is present.
5. Keep `STRIPE_PAYMENT_RECOVERY_ENABLED=false`; Phase 3 alone must not contact a customer.

Phase 3 database verification completed on 2026-08-12:

- All three tables exist remotely with the expected columns and initially contained zero rows.
- `claim_payment_recovery_message` exists and is callable by the server-side service role.
- The paired Slack identity constraint rejected a workspace ID without a user ID (`23514`).
- The nonnegative amount constraint rejected a negative invoice balance (`23514`).
- The unique case/channel/step constraint rejected a duplicate email job (`23505`).
- The first atomic claim changed the test job to `sending` and incremented `attempt_count` to `1`.
- A second claim of the same job returned zero rows, proving concurrent workers cannot both claim it through this function.
- The uniquely labelled synthetic customer, case, and message were removed after verification.
- Post-verification row counts are zero for `crm_customers`, `payment_recovery_cases`, and `payment_recovery_messages`.
- The Phase 2 Stripe webhook ledger and its pending sandbox event were not modified.

### Phase 4 — Transactional email

Status: Implemented and database-verified on 2026-08-12; controlled deployment pending.

- Reuse the low-level Yandex SMTP and Sent-folder archiving behavior.
- Add a dedicated transactional sender without cold-outreach unsubscribe headers.
- Include customer name, amount/currency, a short explanation, and only the Stripe-hosted invoice URL.
- Re-check Stripe immediately before sending.
- Store a durable send record and provider message ID.

Initial message direction:

> Your payment of [amount] is waiting for bank authentication. Please use this secure Stripe link to complete the payment: [link]. If you have already completed it, no action is needed.

Implemented Phase 4 components:

- `database/migrations/004_payment_recovery_processing.sql` adds atomic batch claiming for pending/failed Stripe webhook rows using `FOR UPDATE SKIP LOCKED`.
- Stripe event rows move through `pending/failed -> processing -> processed` or back to `failed` with a sanitized, length-limited error.
- The worker retrieves the stored Stripe Event by ID and then re-fetches the current Invoice, PaymentIntent, Subscription, and Customer before changing CRM state.
- A new recovery case can begin only from `invoice.payment_action_required`, or from `invoice.payment_failed` when the canonical PaymentIntent still has `requires_action`.
- Ordinary card declines and missing-payment-method failures do not create 3DS recovery cases.
- `invoice.paid`, voided/expired invoices, and cancelled subscriptions resolve existing cases and cancel queued notifications.
- A stale action-required event whose invoice has already been paid creates a resolved audit case and schedules no message.
- An actionable invoice must be `open`, have a positive amount remaining, have PaymentIntent status `requires_action`, and expose an HTTPS URL whose hostname is exactly `invoice.stripe.com`.
- The first email job is unique by recovery case, channel, and step, so overlapping Stripe events cannot schedule duplicates.
- Transactional email uses the existing Yandex SMTP submission and Sent-folder archive path but does not add cold-outreach unsubscribe headers.
- The message includes the customer first name when available, correctly formats zero- and multi-decimal currencies, describes the authentication requirement, and includes only the Stripe Hosted Invoice Page.
- Immediately before SMTP submission, the delivery worker claims the job atomically and re-fetches the invoice/payment state from Stripe. If action is no longer required, it cancels the job without sending.
- Delivery records the SMTP RFC Message-ID after acceptance. Failures return the job to `failed` with a sanitized error for retry.
- `api/cron/payment-recovery.js` runs the event worker followed by transactional delivery and uses the existing `CRON_SECRET` authorization pattern.
- Vercel is configured to invoke payment recovery every 15 minutes, seven days per week, independently of cold-outreach business hours.

Phase 4 configuration defaults:

```text
STRIPE_EVENT_PROCESSING_ENABLED=false
STRIPE_PAYMENT_RECOVERY_ENABLED=false
TRANSACTIONAL_EMAIL_ENABLED=false
TRANSACTIONAL_EMAIL_DRY_RUN=true
TRANSACTIONAL_EMAIL_ALLOWLIST=
TRANSACTIONAL_EMAIL_MAX_ATTEMPTS=3
```

Safety gates:

- `STRIPE_EVENT_PROCESSING_ENABLED` controls whether queued Stripe events are claimed.
- `STRIPE_PAYMENT_RECOVERY_ENABLED` controls whether an actionable open case can schedule a notification job.
- `TRANSACTIONAL_EMAIL_ENABLED` controls whether the delivery worker reads due jobs.
- `TRANSACTIONAL_EMAIL_DRY_RUN=true` reports due-job counts without claiming or changing any job.
- When dry-run is disabled, an exact lowercased email match in `TRANSACTIONAL_EMAIL_ALLOWLIST` is still mandatory. An empty allowlist sends to nobody.
- Failed transactional jobs stop being eligible after `TRANSACTIONAL_EMAIL_MAX_ATTEMPTS` claims (default `3`), preventing unbounded retries.
- The payment-recovery cron refuses to run when `CRON_SECRET` is missing and rejects requests without the matching bearer token.
- `STRIPE_ALLOW_LIVE_EVENTS=false` continues to prevent live-event processing.

Controlled activation sequence:

1. Apply `database/migrations/004_payment_recovery_processing.sql` in Supabase.
2. Deploy the Phase 4 code while every new Phase 4 flag remains at its safe default.
3. Set `STRIPE_EVENT_PROCESSING_ENABLED=true` only. Leave recovery and transactional email disabled.
4. Invoke the authenticated payment-recovery cron once.
5. Verify the existing sandbox event becomes `processed`, its already-paid invoice produces one resolved case, and zero message jobs exist.
6. Create a fresh sandbox 3DS-required invoice for an internal test email.
7. Enable `STRIPE_PAYMENT_RECOVERY_ENABLED=true`, `TRANSACTIONAL_EMAIL_ENABLED=true`, keep `TRANSACTIONAL_EMAIL_DRY_RUN=true`, and place only the internal address in the allowlist.
8. Verify dry-run reports one due job without claiming or sending it.
9. Set `TRANSACTIONAL_EMAIL_DRY_RUN=false` for the internal allowlisted recipient and invoke one cycle.
10. Confirm one SMTP-accepted email, one Sent-folder copy, and one `sent` message record.
11. Complete 3DS and verify the paid event resolves the case with no further messages.

Phase 4 local verification:

- Automated tests cover trusted Stripe URLs, currency formatting, message content, actionable-state classification, stale-paid event handling, recovery-disabled behavior, ordinary payment-failure exclusion, dry-run non-mutation, allowlist enforcement, fresh Stripe re-checks, and successful delivery-state recording.
- All customer-contact and live-event gates remain disabled locally and must remain disabled during the initial deployment.

Migration 004 verification completed on 2026-08-12:

- `claim_stripe_webhook_events` is present and callable by the service-role worker.
- One uniquely labelled synthetic `pending` event was inserted with an earlier isolated `received_at` timestamp.
- A one-row atomic claim returned only that synthetic event and changed it to `processing`.
- The synthetic event was deleted after verification and no test row remains.
- The real sandbox event `evt_1U3CUhAe3OxHSCAxPhWoosW1` remained `pending` before and after the test.
- No CRM case or notification job was created and no email was sent during migration verification.

### Phase 5 — Slack delivery

Create a dedicated Slack app rather than depending on a personal session.

Expected minimal scopes:

- `chat:write`
- `users:read.email`
- `im:write`

Flow:

1. Prefer an explicitly stored Stripe-customer-to-Slack-user mapping.
2. Optionally bootstrap the mapping by matching customer and Slack email.
3. Open or resume a bot DM.
4. Send the recovery message with the Stripe-hosted link.
5. On lookup or DM failure, record the error and alert an internal channel.

Constraints:

- Stripe and Slack email addresses may differ.
- External or Slack Connect members may not always be visible or DM-able by the app.
- Messages will come from the EpsiFlow bot, not a personal user.

### Phase 6 — Reconciliation and reminder scheduler

Add an authenticated endpoint such as `GET /api/cron/payment-recovery`.

Responsibilities:

- Re-read unresolved invoices from Stripe.
- Cancel jobs for paid, voided, cancelled, or expired cases.
- Send due reminders.
- Periodically discover recent qualifying invoices missed by webhooks.
- Route exhausted failures to an internal alert channel.

Proposed initial cadence, subject to Phase 1 findings:

- Email immediately.
- Slack after 15–30 minutes if mapped and still unpaid.
- One final reminder after 6–8 hours.
- Stop immediately on payment or any terminal state.

### Phase 7 — Testing and controlled rollout

Automated coverage:

- 3DS-required versus ordinary payment failure classification.
- Duplicate and out-of-order webhook events.
- Payment completed between job selection and actual delivery.
- Missing customer email or Slack mapping.
- Expired, cancelled, paid, or void invoice.
- Slack and SMTP transient failures and rate limits.
- Webhook signature failure.

Sandbox acceptance flow:

1. Create a test customer and payment requiring 3DS.
2. Confirm exactly one recovery case is created.
3. Confirm the email contains the correct hosted invoice URL.
4. Confirm a mapped test Slack user receives one bot DM.
5. Complete 3DS.
6. Confirm `invoice.paid` resolves the case.
7. Confirm no later reminder is delivered.

Rollout gates:

1. Feature disabled by default.
2. Dry-run against sandbox events.
3. Internal allowlist.
4. Live dry-run with no delivery.
5. Enable email.
6. Enable Slack only for explicitly mapped clients.
7. Review recovery and failure records before adding later reminders.

## MVP scope

Included:

- Stripe webhook ingestion.
- Supabase recovery case and message records.
- Immediate transactional email containing the Hosted Invoice Page.
- Stop-on-paid behavior.
- One Slack DM for explicitly mapped clients.
- Cron reconciliation.
- Dry-run mode, kill switches, and automated tests.

Deferred:

- Full CRM dashboard.
- Two-way Slack reply ingestion.
- Complex multistep dunning.
- General non-payment CRM workflows, which will build on the same customer, event, job, and message foundations later.

## Non-negotiable safeguards

- Never commit or log Stripe/Slack secrets.
- Prefer a restricted Stripe key with least privilege.
- Verify every Stripe webhook signature using the raw body.
- Re-check current Stripe state immediately before sending.
- Deduplicate both webhook events and notification jobs.
- Never send or store card details.
- Never mix transactional recovery state with cold-outreach campaign state.
- Keep independent kill switches for Stripe processing, email, and Slack.
- Use sandbox and allowlisted recipients before live delivery.

## Decisions still to confirm

- Whether relevant billing includes subscriptions, one-off invoices, or both.
- Exact reminder cadence after observing the real expiry behavior.
- Transactional sender name and reply-to address.
- Slack workspace and whether clients are members or Slack Connect guests.
- Whether Slack mapping is manually approved or may auto-match by email.
- Internal Slack channel for operational failures.
