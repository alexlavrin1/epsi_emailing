# EpsiFlow backup and recovery runbook

## Recovery objectives

Until a timed drill proves better targets, use a 24-hour recovery point objective (RPO) and four-hour recovery time objective (RTO). Review these targets after material data-volume or workflow changes.

The dashboard organization export is a portability and inspection artifact, not a full database backup. It is row-capped and intentionally excludes secrets and unrestricted audit metadata.

## Backup layers

1. Confirm the Supabase project's managed backup coverage and oldest/latest available restore points at least monthly. Paid projects receive managed daily backups with plan-dependent retention; projects needing a tighter RPO should evaluate PITR.
2. Keep an encrypted, access-controlled logical backup off the primary platform when required by the business continuity policy. Follow Supabase's current CLI backup guide rather than storing database passwords in scripts.
3. Download the administrator organization export monthly and after major migrations. Run `npm run export:verify -- /path/to/export.json`, record only its SHA-256 checksum and aggregate counts, then store the file encrypted with restricted access.
4. Keep GitHub as the source for migrations and application code. Keep a separate private configuration inventory for Vercel variables, Supabase Auth settings, webhook endpoints, schedules, and provider credentials—never their secret values.

Supabase database backups do not restore Storage objects, and restoring/cloning a database does not reproduce every project setting or deployment secret. EpsiFlow currently treats Vercel configuration and provider credentials as a separate recovery layer.

## Quarterly non-production recovery drill

1. Choose a recent backup and create a separate restored Supabase project. Never test recovery by overwriting production.
2. Do not connect the production Vercel projects or provider credentials to the restored project. Disable any database extension, webhook, cron, or network function capable of external operations before testing.
3. Recreate only the minimum non-secret project settings required for inspection. Use new recovery-project API keys.
4. Run `database/tests/002_recovery_readiness.sql` as one query in the restored project's SQL Editor. It is rollback-only and returns aggregate assertions without exposing client records.
5. Compare aggregate organization/contact/audit counts with the latest verified export or private operations record. Investigate unexplained gaps.
6. Confirm RLS, administrator MFA configuration, and service-role-only worker permissions before any application is pointed at the clone.
7. Record backup timestamp, restore start/end times, achieved RPO/RTO, test result, operator, exceptions, and remediation items. Do not record credentials or client data.
8. Remove the recovery project after evidence is retained and remediation is assigned. Project removal is an explicit owner action and is not automated by this repository.

## Production recovery decision

A production restore is destructive and causes downtime. It requires the workspace owner to identify the incident window, pause EpsiFlow delivery, preserve logs/evidence, select a restore point before the damaging event, notify operators, and explicitly approve the restore in Supabase. After restoration, rotate affected credentials, redeploy Vercel, recreate external settings, run the recovery-readiness and RLS suites, verify worker health, and resume automations gradually.

## Current Supabase references

- [Database backups](https://supabase.com/docs/guides/platform/backups)
- [Restore to a new project](https://supabase.com/docs/guides/platform/clone-project)
- [CLI backup and restore](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)
