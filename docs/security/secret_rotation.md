# EpsiFlow secret rotation runbook

## Purpose and cadence

Use this runbook after suspected exposure, staff or vendor access changes, and as a scheduled operational exercise. Rotate one provider at a time so failures have a single cause. Never paste a credential into GitHub, Supabase rows, tickets, chat, logs, or browser-visible `NEXT_PUBLIC_*` variables.

Keep server credentials only in the engine deployment environment and the local root `.env.local`. The dashboard project may contain only the three browser-safe variables documented in `dashboard/.env.example`.

## Before every rotation

1. In the dashboard, pause all automations and record a reason naming the provider being rotated.
2. Keep external-delivery switches disabled or in dry-run mode where applicable.
3. Record the credential owner, provider, start time, and deployment target in the private operations log. Record identifiers and timestamps, never secret values.
4. Confirm access to both the provider console and every Vercel project that consumes the credential.
5. Run `npm run secrets:check`. Resolve configuration or tracked-secret failures before continuing.

## Standard rotation sequence

1. Create a replacement credential at the provider with the minimum permissions EpsiFlow needs.
2. Add the replacement to the correct Vercel Production, Preview, and Development scopes. Update the root `.env.local` separately when local operations use it.
3. Redeploy the consuming project. Environment changes do not affect an already-running deployment.
4. Run `npm run secrets:check`, then `npm run preflight`. The preflight is read-only but contacts SMTP, IMAP, Instantly, and Supabase.
5. Confirm one successful outreach-worker heartbeat in the Automations dashboard. For Stripe or Slack, also use the provider's non-destructive connection/test facility or an allowlisted dry run.
6. Revoke the old credential only after the replacement deployment is healthy.
7. Resume automations and watch the next worker cycle. Record completion and the next planned rotation date.

If verification fails, leave automations paused, restore the previous environment value while it remains valid, redeploy, and investigate before revoking anything.

## Provider inventory

| Provider | Server environment values | Verification | Important boundary |
| --- | --- | --- | --- |
| Supabase | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | `npm run preflight`; worker heartbeat | The service/secret key must never exist in the dashboard project. Rotate the server key, not the public anon/publishable key used by the browser. |
| Yandex | `YANDEX_EMAIL`, `YANDEX_PASSWORD` | SMTP verify and read-only IMAP inbox check in preflight | Use a dedicated application password when the account supports it. Confirm both sending and inbox access before revocation. |
| Vercel cron | `CRON_SECRET` | Authenticated cron request and next worker heartbeat | Generate at least 32 random characters. Update the project serving `/api/cron/*`. |
| Instantly | `INSTANTLY_API_KEY` and optional webhook secret | Read-only list/lead checks in preflight | Keep permissions limited to the synchronization behavior in use. |
| Stripe | `STRIPE_RESTRICTED_KEY`, `STRIPE_WEBHOOK_SECRET` | Provider test event, dry-run processing, dashboard recovery health | Restricted API keys and endpoint signing secrets are separate credentials and should be rotated/verified separately. Keep live-event controls off during verification. |
| Slack | `SLACK_BOT_TOKEN`, `SLACK_TEAM_ID` | `npm run check:slack`; allowlisted dry run | Confirm the workspace ID and required scopes after token replacement or app reinstall. |
| Acquisition | `APOLLO_API_KEY`, `KVK_API_KEY` | Preview/dry-run import only | These are not needed by the dashboard or normal outreach worker; keep them out of those deployments. |

## Exposure response

1. Pause automations immediately and disable affected delivery paths.
2. Revoke the exposed credential at its provider; do not wait for the normal overlap sequence when active misuse is possible.
3. Replace it in every consuming deployment and local environment, then redeploy.
4. Search provider access logs, Vercel logs, Supabase audit history, and Git history for the exposure window. Do not copy raw credentials into the incident record.
5. If a secret ever entered Git, treat deletion from the current file as insufficient: rotate it immediately and review repository history and forks.
6. Run the permission/RLS regression suite, the secret audit, and preflight before resuming automations.

## Completion evidence

A rotation is complete only when the replacement has passed its provider check, the consuming deployment has been redeployed, the old credential is revoked, worker health is normal, and the private operations log contains the owner and completion timestamp.
