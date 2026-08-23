# EpsiFlow Slack Integration Plan

## Current state

The Clients workspace can store a persistent Slack conversation link and open it in Slack. It does not currently copy Slack messages into EpsiFlow or send Slack messages from the dashboard. Saving a Slack URL alone does not grant API access to that conversation.

## Product goal

Make relevant Slack Connect conversations visible from each client workspace and allow EpsiFlow to prepare safe, contextual Slack replies. Operators remain in control of external communication.

## Required Slack setup

- Invite the EpsiFlow Slack app to each shared Slack Connect channel that it should access.
- Grant the app the history scope appropriate to the channel type (`channels:history` for public channels or `groups:history` for private channels).
- Grant `chat:write` before delivery is enabled.
- Reinstall or reauthorize the Slack app after adding scopes.
- Respect both organizations' Slack Connect and app-management policies.

The app must never treat a pasted conversation URL as authorization. Server-side access must be confirmed with Slack before synchronization or delivery is enabled.

## Delivery phases

### Phase 1 — Read-only conversation synchronization

- Resolve and validate the Slack channel ID from the saved conversation link.
- Verify that the configured Slack app can access the channel.
- Fetch message history through Slack's `conversations.history` API.
- Store tenant-scoped message metadata and sanitized message content.
- Synchronize incrementally using Slack timestamps and cursors.
- Group replies into Slack threads and show them chronologically on the client page.
- Display clear states for connected, permission required, inaccessible, and synchronization failed.
- Record synchronization health without storing access tokens or raw provider errors.

Outcome: operators can read the relevant client conversation from EpsiFlow while Slack remains the source of truth.

### Phase 2 — Approval-gated Slack drafts

- Add Slack as a draft channel in the existing approval queue.
- Allow manual drafts from the client workspace.
- Allow versioned playbooks to prepare Slack drafts using client and CRM context.
- Require an operator to review, edit, approve, skip, or cancel every draft.
- Recheck client, channel, workflow, runtime-pause, and permission state immediately before delivery.
- Send approved messages through Slack's `chat.postMessage` API.
- Show clearly that the message will be authored by the EpsiFlow Slack app, not the operator's personal Slack account.
- Store the Slack message timestamp and an audit event after successful delivery.

Outcome: EpsiFlow can prepare Slack communication, but no external message is sent without explicit approval.

### Phase 3 — Controlled automation and monitoring

- Add configurable triggers and stop conditions for low-risk client-success workflows.
- Retain approval by default; automatic delivery must be a separate, explicitly enabled mode.
- Apply organization-wide and per-client rate limits.
- Prevent duplicate messages with idempotency keys.
- Respect the global automation pause and client-level communication stops.
- Add retries, sanitized failures, synchronization freshness, and delivery health to monitoring.
- Include Slack records in retention, export, RLS, and permission regression coverage.

Outcome: Slack workflows are observable, reversible where possible, and governed by the same safety controls as email automations.

## Security and privacy rules

- Keep Slack tokens server-side only.
- Require organization membership for every message read and action.
- Store channel and message identifiers only within the owning organization.
- Never send merely because a draft was generated.
- Audit configuration changes, approvals, cancellations, and deliveries.
- Avoid collecting unrelated workspace conversations.
- Apply an explicit retention policy to synchronized Slack content.
- Provide a per-client disconnect and an organization-wide Slack kill switch.

## Recommended implementation order

1. Read-only history for one explicitly linked Slack Connect channel.
2. Threaded dashboard conversation view and sync health.
3. Manual Slack drafts in the approval queue.
4. Approved delivery as the EpsiFlow app.
5. Playbook-created drafts.
6. Carefully selected automatic actions only after production usage is understood.

