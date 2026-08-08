# Local acquisition delivery

Status: Implemented in code; live Supabase setup is blocked by an invalid or unavailable project URL.

## Ownership

- Instantly is the read-only sourcing database.
- Supabase is the canonical contact, suppression, campaign, send, and reply database.
- Yandex SMTP sends the messages.
- Yandex IMAP detects replies, unsubscribe requests, and common delivery failures.
- The local campaign is `Epsi Test v1 - Local`; the Instantly campaign must remain in Draft.

Never run the same prospect/campaign through Instantly delivery and this engine at the same time.

## Safety defaults

```text
OUTREACH_ENABLED=false
DAILY_SEND_LIMIT=60
DAILY_NEW_LEAD_LIMIT=30
SENDS_PER_CYCLE=2
SEND_TIMEZONE=Asia/Kolkata
SEND_START_HOUR=9
SEND_END_HOUR=18
REPLY_LOOKBACK_DAYS=30
LOCAL_CAMPAIGN_NAME=Epsi Test v1 - Local
```

`OUTREACH_ENABLED=false` prevents delivery even if a campaign or scheduled-send row is accidentally active. A campaign must also have `status=active` before it can send.

The scheduler checks every 15 minutes and sends at most two messages per cycle. Follow-ups are prioritized over new leads. Total sends stop at 60 per India-local day, and no more than 30 new leads are introduced per day.

## Sequence

The local sequence mirrors the approved Instantly campaign:

| Step | Timing | Subject |
|---|---:|---|
| 1 | Day 0 | `Shopify Ads` |
| 2 | Day 3 | Threaded reply |
| 3 | Day 8 | Threaded reply |
| 4 | Day 14 | Threaded reply |

Every step is plain text, uses the mailbox signature, and tells recipients they can reply with `unsubscribe`. Messages also include a mailto `List-Unsubscribe` header.

To send an immediate four-message thread to an internal test inbox without activating the campaign:

```bash
npm run test:email -- --to you@example.com --threaded-sequence --send
```

The test uses the real Step 1 subject and sends Steps 2–4 with `Re:`, `In-Reply-To`, and `References` headers. It does not create campaign send records or contact enrolled leads.

## Source sync

Preview the configured Instantly list without writing:

```bash
npm run sync:instantly:dry
```

Import verified unique contacts into `prospects` without enrollment:

```bash
npm run sync:instantly
```

After the paused local campaign exists, import and enroll the same verified contacts:

```bash
npm run sync:instantly -- --enroll
```

The sync normalizes email addresses, skips invalid and unverified contacts, preserves existing suppression statuses, upserts by email, and uses the unique campaign/prospect/step constraint to prevent duplicate enrollment.

## Setup and activation order

1. Correct `SUPABASE_URL` and confirm the project is reachable.
2. Add `SUPABASE_SERVICE_ROLE_KEY` to the server environment. Do not expose it to frontend code.
3. Apply `database/migrations/001_secure_outreach_rls.sql` in the Supabase SQL editor.
4. Run `npm run setup:mailbox` and verify the stored sender name/signature.
5. Run `npm run setup:campaign`; it creates or resets the local campaign as paused.
6. Run `npm run sync:instantly:dry` and review the counts.
7. Run `npm run sync:instantly -- --enroll`.
8. Run `npm test`.
9. Run `npm run preflight` and require every connection to pass.
10. Send internal SMTP tests for all four steps.
11. Verify reply, unsubscribe, and bounce behavior using controlled inboxes.
12. Change the Supabase campaign status to `active`.
13. Set `OUTREACH_ENABLED=true` only after every prior check passes.

Both gates must be open before delivery. Keeping the environment switch last makes activation intentional.

## Reply and suppression behavior

- Any direct reply marks the campaign conversation replied and stops its scheduled follow-ups.
- A reply whose subject or first line is an unsubscribe request permanently marks the prospect `unsubscribed` and stops all scheduled outreach.
- A recognized delivery failure marks the prospect `bounced` and stops all scheduled outreach.
- IMAP reads the inbox without changing message flags.

Yandex requires IMAP access and app-password/OAuth access to be enabled. The configured servers are `smtp.yandex.com:465` and `imap.yandex.com:993`, both over TLS.

## Deployment note

The persistent Node scheduler runs every 15 minutes. `vercel.json` requests the same cadence, which may require a Vercel plan that supports frequent cron jobs. If the deployment plan does not, run `npm start` as a persistent worker on another host or accept a slower cadence by reducing the cron frequency.
