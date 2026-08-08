# Instantly integration architecture

Status: Superseded for delivery. Instantly is now used only as a read-only sourcing database; see `local_delivery.md` for the implemented architecture.

## Decision

Use **Supabase as the canonical acquisition database**, **Instantly as the read-only lead source**, and the local Yandex SMTP/IMAP engine as the email execution layer.

- Supabase owns contacts, qualification, acquisition stages, suppression state, campaign reporting, and onboarding/activation outcomes.
- Instantly owns sourcing and list maintenance only.
- The Node.js engine imports verified contacts, sends through Yandex SMTP, and reconciles replies, unsubscribes, and bounces through Yandex IMAP.
- Keep the Instantly campaign in Draft so no prospect can have two senders of record.

There must be one sender of record for any prospect/campaign pair. Running the same sequence through both Instantly and `src/outreach/engine.js` would risk duplicate messages and conflicting status.

## API connection

Instantly API v2 uses bearer-token authentication:

```http
Authorization: Bearer <INSTANTLY_API_KEY>
```

Create a workspace API key in Instantly's Integrations → API Keys area. For the polling-first integration supported by the current plan, select:

- `lead_lists:read`
- `leads:read`
- `campaigns:read`
- `emails:read`

`emails:read` allows reconciliation to retrieve sent messages and received replies. No Instantly write scopes are required for the first implementation.

If the workspace is later upgraded to a plan with webhooks, add `webhooks:all`. If the UI exposes individual webhook actions instead, select `webhooks:read`, `webhooks:create`, `webhooks:update`, and `webhooks:delete`.

For an initial read-only connection/import test, only `lead_lists:read`, `leads:read`, and `campaigns:read` are required. Add `leads:create` or `leads:update` only if the engine will later push or modify leads in Instantly. Add `emails:create` only if replies will later be sent from this application. Store the key as `INSTANTLY_API_KEY`; never store it in Supabase rows, logs, or source control.

Official endpoints used by this design:

| Purpose | Endpoint |
|---|---|
| Find the configured list | `GET https://api.instantly.ai/api/v2/lead-lists` |
| Page through its contacts | `POST https://api.instantly.ai/api/v2/leads/list` |
| Create event subscriptions | `POST https://api.instantly.ai/api/v2/webhooks` |
| Inspect a lead during reconciliation | `GET https://api.instantly.ai/api/v2/leads/{id}` |

The list-leads request accepts a `list_id`, `limit`, and cursor. Continue using each response's `next_starting_after` until it is absent.

## Initial contact import

The one-time bootstrap should:

1. Fetch the available Instantly lead lists and resolve the configured list by ID, not name.
2. Request every lead in that list using cursor pagination.
3. Normalize email addresses with `trim().toLowerCase()`.
4. Validate required fields and quarantine malformed records rather than silently dropping them.
5. Upsert every unique address into `prospects` using the existing unique email constraint.
6. Store the Instantly lead ID, list ID, source timestamps, and original payload for traceability.
7. Never create local `outreach_sends` rows for a campaign Instantly is already executing.
8. Produce an import summary: fetched, inserted, updated, duplicates, missing email, and failed.

The import must be idempotent. Running it twice should update the same prospect records without enrolling or contacting anyone twice.

## Suggested Supabase changes

### `prospects`

Add fields for source identity and synchronization:

```sql
instantly_lead_id       TEXT
instantly_list_id       TEXT
instantly_workspace_id  TEXT
source                  TEXT NOT NULL DEFAULT 'manual'
source_payload          JSONB
source_updated_at       TIMESTAMPTZ
suppressed_at           TIMESTAMPTZ
suppression_reason      TEXT
website_url             TEXT
```

Use a unique index on `(instantly_workspace_id, instantly_lead_id)` where the external ID is present. Email remains the cross-source deduplication key.

`website_url` is included because the existing Apollo importer already writes it although the checked-in schema does not currently define it.

### `campaigns`

Add execution ownership:

```sql
execution_provider       TEXT NOT NULL DEFAULT 'local'
instantly_campaign_id    TEXT
instantly_workspace_id   TEXT
```

Allowed providers should initially be `local` and `instantly`. The local scheduler must select only `execution_provider = 'local'` campaigns.

### `outreach_events`

Create an immutable inbox for external events:

```sql
id                UUID PRIMARY KEY DEFAULT gen_random_uuid()
provider          TEXT NOT NULL
event_fingerprint TEXT NOT NULL UNIQUE
event_type        TEXT NOT NULL
prospect_id       UUID REFERENCES prospects(id)
campaign_id       UUID REFERENCES campaigns(id)
occurred_at       TIMESTAMPTZ NOT NULL
payload           JSONB NOT NULL
processed_at      TIMESTAMPTZ
processing_error  TEXT
created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
```

Instantly's documented webhook payload does not expose a universal event ID. Build a stable SHA-256 fingerprint from provider, workspace, campaign, event type, lead email, email ID, step, and event timestamp so webhook retries remain idempotent.

### Send and reply records

Retain `outreach_sends` and `prospect_replies` as the normalized reporting layer. Add provider IDs where useful:

```sql
provider_email_id  TEXT
provider_lead_id   TEXT
provider_variant   INTEGER
provider_payload   JSONB
```

Store message bodies only if they are needed operationally, and establish an explicit retention policy because replies may contain personal or sensitive information.

## Optional real-time event sync

This section is not required on the current Instantly plan. Scheduled reconciliation described below is the source of synchronization until webhook access is available.

Add a public HTTPS endpoint such as:

```text
POST /api/webhooks/instantly
```

Create Instantly webhook subscriptions for:

- `email_sent`
- `reply_received`
- `email_bounced`
- `lead_unsubscribed`
- `lead_interested`
- `lead_not_interested`
- `lead_out_of_office`
- `lead_wrong_person`
- `campaign_completed`
- `account_error`

Instantly supports adding custom HTTP headers to webhook delivery. Configure a dedicated secret header, for example:

```http
Authorization: Bearer <INSTANTLY_WEBHOOK_SECRET>
```

The handler should:

1. Authenticate before reading or logging the payload.
2. Validate the workspace and campaign against configured IDs.
3. Normalize `lead_email` and resolve the Supabase prospect.
4. Insert the raw event using the deterministic fingerprint.
5. Return success for an already-recorded duplicate.
6. Apply the normalized state transition.
7. Return a non-2xx response only for a genuinely retryable failure.

Do not treat webhook arrival order as guaranteed. State changes should compare event timestamps so an older delivery cannot overwrite a newer state.

## Event mapping

| Instantly event | Supabase action |
|---|---|
| `email_sent` | Upsert the matching `outreach_sends` step as `sent`; store provider email ID, step, variant, sender, and timestamp. |
| `reply_received` | Save the reply, mark the prospect/campaign as replied, and stop any locally scheduled sends. |
| `email_bounced` | Mark the prospect `bounced`, suppress future outreach, and cancel scheduled sends. |
| `lead_unsubscribed` | Mark the prospect `unsubscribed`, set permanent suppression, and cancel all scheduled sends. |
| `lead_interested` | Move the acquisition stage to interested/qualified for human review. |
| `lead_not_interested` | Stop outreach and record the outcome; suppress according to the rulebook. |
| `lead_out_of_office` | Record the event without classifying it as a positive or negative reply. Rescheduling policy belongs in the rulebook. |
| `lead_wrong_person` | Stop outreach to that contact and create a task to find the correct owner if the account remains qualified. |
| `campaign_completed` | Mark the external campaign run complete after reconciliation. |
| `account_error` | Raise an operational alert; do not silently continue enrollment. |

Unsubscribe and bounce updates are global prospect-level safety controls, not merely campaign analytics.

## Polling and reconciliation

Run an incremental reconciliation job regularly and a full consistency pass daily. A reasonable starting interval is hourly; reduce it only if fresher Supabase reporting is operationally important:

1. Page through leads in the configured list/campaign using Instantly cursors.
2. Fetch emails created since the last successful checkpoint, filtered by campaign where possible.
3. Compare campaign, reply, bounce, unsubscribe, interest, verification, and contact timestamps with Supabase.
4. Apply changes idempotently and in timestamp order.
5. Record a durable checkpoint only after the full page/batch commits.
6. Alert on repeated `401`, `402`, or `429` responses.

Enable Instantly's own **Stop sending emails on reply** campaign option. This ensures follow-ups stop immediately inside Instantly even though Supabase is updated later by polling.

Instantly documents workspace-wide limits of 100 requests per second and 6,000 per minute. The expected EpsiFlow volume is far below this, but the client should still retry `429` and transient `5xx` responses with exponential backoff and jitter.

## Proposed project structure

```text
src/integrations/instantly/client.js       API client, auth, pagination, retries
src/integrations/instantly/importer.js     list-to-Supabase bootstrap and sync
src/integrations/instantly/events.js       validation and normalized event mapping
api/webhooks/instantly.js                  optional authenticated webhook endpoint
api/cron/instantly-reconcile.js            polling and periodic drift repair
scripts/import_instantly_contacts.js       dry-run and live bootstrap command
```

Suggested environment variables:

```text
INSTANTLY_API_KEY=
INSTANTLY_LIST_ID=
INSTANTLY_WORKSPACE_ID=
INSTANTLY_CAMPAIGN_ID=
# Optional after upgrading to webhook access:
INSTANTLY_WEBHOOK_SECRET=
```

## Rollout order

1. Export or snapshot the Instantly list for rollback/audit purposes.
2. Apply the Supabase migration.
3. Implement a read-only API connection test.
4. Run the contact import in dry-run mode and review counts.
5. Import/upsert contacts into Supabase.
6. Run polling/reconciliation against a small test campaign.
7. Confirm replies, bounces, and unsubscribes propagate to Supabase.
8. Mark the production campaign `execution_provider = 'instantly'`.
9. Confirm the local scheduler excludes it before activating Instantly sending.
10. Optionally add webhooks later without changing the normalized event model.

## Acceptance criteria

- Every valid contact in the selected Instantly list has exactly one Supabase prospect record.
- Re-running imports produces no duplicate prospects or campaign enrollments.
- Every sent, replied, bounced, and unsubscribed state reaches the normalized Supabase records within the polling interval.
- Repeated and out-of-order API results do not regress state or duplicate replies.
- An unsubscribe or bounce prevents all future local sends.
- No prospect/campaign pair can be executed by both Instantly and the local SMTP scheduler.
- A reconciliation run can restore Supabase after a deliberately skipped polling cycle.
- API and webhook secrets never appear in logs or committed files.

## Official documentation

- [Getting started and API keys](https://developer.instantly.ai/getting-started/getting-started)
- [List lead lists](https://developer.instantly.ai/api-reference/leadlist/list-lead-list)
- [List leads](https://developer.instantly.ai/api-reference/lead/list-leads)
- [Webhook event payloads](https://developer.instantly.ai/guides/webhook-events)
- [Create webhook](https://developer.instantly.ai/api-reference/webhook/create-webhook)
- [API rate limits](https://developer.instantly.ai/getting-started/rate-limit)
