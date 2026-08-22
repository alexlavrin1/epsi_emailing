import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test, { after, before } from "node:test";

const root = new URL("../", import.meta.url);
const port = 39000 + (process.pid % 1000);
const origin = `http://127.0.0.1:${port}`;
let server;

before(async () => {
  const nextBin = fileURLToPath(new URL("../node_modules/next/dist/bin/next", import.meta.url));
  server = spawn(process.execPath, [nextBin, "start", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: fileURLToPath(root),
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let lastError;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (server.exitCode !== null) {
      const stderr = await new Promise((resolve) => {
        let output = "";
        server.stderr.on("data", (chunk) => { output += chunk; });
        server.stderr.on("end", () => resolve(output));
      });
      throw new Error(`Next.js test server exited early: ${stderr}`);
    }
    try {
      const response = await fetch(origin);
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw lastError ?? new Error("Next.js test server did not become ready.");
});

after(() => {
  server?.kill("SIGTERM");
});

async function render(pathname = "/") {
  return fetch(`${origin}${pathname}`, {
    headers: { accept: "text/html" },
    redirect: "manual",
  });
}

test("server-renders the EpsiFlow invite-only sign-in screen", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /<title>EpsiFlow<\/title>/i);
  assert.match(html, /Every client signal, in one secure workspace/i);
  assert.match(html, /Sign in securely/i);
  assert.match(html, /Forgot password\?/i);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
});

test("server-renders the password recovery screen", async () => {
  const response = await render("/forgot-password");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Create your password/i);
  assert.match(html, /Send password link/i);
  assert.match(html, /Back to sign in/i);
});

test("rejects incomplete recovery callbacks", async () => {
  const response = await render("/auth/callback");
  assert.ok([302, 303, 307, 308].includes(response.status));
  const redirect = new URL(response.headers.get("location"), "http://localhost");
  assert.equal(redirect.pathname, "/forgot-password");
  assert.equal(redirect.searchParams.get("error"), "missing-code");
});

test("protects the choose-password screen without a recovery session", async () => {
  const response = await render("/update-password");
  assert.ok([302, 303, 307, 308].includes(response.status));
  assert.equal(new URL(response.headers.get("location"), "http://localhost").pathname, "/forgot-password");
});

test("protects the dashboard route when no session is present", async () => {
  const response = await render("/dashboard");
  assert.ok([302, 303, 307, 308].includes(response.status));
  assert.equal(new URL(response.headers.get("location"), "http://localhost").pathname, "/");
});

test("keeps privileged credentials out of dashboard source", async () => {
  const files = [".env.example", "lib/env.ts", "lib/supabase-server.ts", "lib/supabase-route.ts"];
  const source = (await Promise.all(files.map((file) => readFile(new URL(file, root), "utf8")))).join("\n");
  assert.doesNotMatch(source, /SUPABASE_SERVICE_ROLE_KEY\s*=/);
  assert.match(source, /NEXT_PUBLIC_SUPABASE_ANON_KEY/);
});

test("uses a cookie-backed PKCE client for password recovery", async () => {
  const source = await readFile(new URL("app/api/auth/password-reset/route.ts", root), "utf8");
  assert.match(source, /createSupabaseRouteClient\(request\)/);
  assert.match(source, /applyCookies\(NextResponse\.json\(\{ ok: true \}\)\)/);
  assert.doesNotMatch(source, /createClient\(/);
});

test("ships the read-only Phase 2 CRM surfaces", async () => {
  const files = [
    "app/dashboard/page.tsx",
    "app/dashboard/crm/page.tsx",
    "app/dashboard/pipeline/page.tsx",
    "app/dashboard/companies/page.tsx",
    "app/dashboard/inbox/page.tsx",
    "app/dashboard/crm/[kind]/[id]/page.tsx",
    "lib/dashboard-data.ts",
  ];
  const source = (await Promise.all(files.map(file => readFile(new URL(file, root), "utf8")))).join("\n");
  assert.match(source, /Attention queue/);
  assert.match(source, /Contacts and clients/);
  assert.match(source, /Activity timeline/);
  assert.match(source, /Lifecycle pipeline/);
  assert.match(source, /Slack recovery delivery/);
  assert.doesNotMatch(source, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(source, /\.insert\(|\.update\(|\.delete\(/);
});

test("keeps lifecycle classification deterministic and read-only", async () => {
  const source = await readFile(new URL("lib/dashboard-data.ts", root), "utf8");
  assert.match(source, /email:\$\{prospect\.email\.trim\(\)\.toLowerCase\(\)\}/);
  assert.match(source, /"prospect" \| "interested" \| "client" \| "at_risk" \| "suppressed"/);
  assert.match(source, /\.eq\("channel", "slack"\)/);
  assert.doesNotMatch(source, /\.insert\(|\.update\(|\.delete\(/);
});

test("defines tenant RLS and an append-only audit log", async () => {
  const [foundation, auditLock] = await Promise.all([
    readFile(new URL("../database/migrations/006_dashboard_security_foundation.sql", root), "utf8"),
    readFile(new URL("../database/migrations/010_lock_audit_log_writes.sql", root), "utf8"),
  ]);
  assert.match(foundation, /ALTER TABLE organizations ENABLE ROW LEVEL SECURITY/i);
  assert.match(foundation, /dashboard_is_org_member/i);
  assert.match(foundation, /dashboard_assign_single_organization/i);
  assert.match(auditLock, /DROP POLICY IF EXISTS audit_actor_insert/i);
  assert.match(auditLock, /REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON audit_events FROM authenticated/i);
  assert.match(auditLock, /GRANT SELECT ON audit_events TO authenticated/i);
});

test("routes Phase 3 contact writes through audited database functions", async () => {
  const [migration, actions, form] = await Promise.all([
    readFile(new URL("../database/migrations/007_safe_crm_operator_actions.sql", root), "utf8"),
    readFile(new URL("app/dashboard/crm/[kind]/[id]/actions.ts", root), "utf8"),
    readFile(new URL("app/components/contact-actions.tsx", root), "utf8"),
  ]);
  assert.match(migration, /CREATE POLICY crm_contact_notes_member_read[\s\S]*FOR SELECT/i);
  assert.doesNotMatch(migration, /CREATE POLICY crm_contact_(?:notes|tasks|overrides).*FOR (?:INSERT|UPDATE|DELETE)/i);
  assert.match(migration, /dashboard_set_lifecycle_stage[\s\S]*INSERT INTO audit_events/i);
  assert.match(migration, /dashboard_add_contact_note[\s\S]*INSERT INTO audit_events/i);
  assert.match(migration, /dashboard_create_contact_task[\s\S]*INSERT INTO audit_events/i);
  assert.match(actions, /\.rpc\("dashboard_set_lifecycle_stage"/);
  assert.match(actions, /revalidatePath\("\/dashboard\/pipeline"\)/);
  assert.doesNotMatch(actions + form, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(form, /Operator actions are ready to install/);
  assert.match(form, /Saving…/);
});

test("keeps outreach controls tenant-scoped, confirmed, and audited", async () => {
  const [migration, campaignActions, campaignControls, contactControls] = await Promise.all([
    readFile(new URL("../database/migrations/008_safe_outreach_controls.sql", root), "utf8"),
    readFile(new URL("app/dashboard/campaigns/actions.ts", root), "utf8"),
    readFile(new URL("app/components/campaign-controls.tsx", root), "utf8"),
    readFile(new URL("app/components/contact-actions.tsx", root), "utf8"),
  ]);
  assert.match(migration, /organization_id = target_organization_id/i);
  assert.match(migration, /outreach\.campaign\.status_changed/);
  assert.match(migration, /outreach\.prospect\.stopped/);
  assert.match(migration, /WHERE prospect_id = target_prospect_id AND status = 'scheduled'/i);
  assert.match(campaignActions, /\.rpc\("dashboard_set_campaign_status"/);
  assert.match(campaignControls + contactControls, /window\.confirm/);
  assert.doesNotMatch(campaignActions + campaignControls + contactControls, /SUPABASE_SERVICE_ROLE_KEY/);
});

test("approval-gates replies and recovery retries without exposing mailbox tokens", async () => {
  const [migration, actions, approvalControls, draftForm] = await Promise.all([
    readFile(new URL("../database/migrations/009_approved_replies_and_retries.sql", root), "utf8"),
    readFile(new URL("app/dashboard/approvals/actions.ts", root), "utf8"),
    readFile(new URL("app/components/approval-controls.tsx", root), "utf8"),
    readFile(new URL("app/components/reply-draft-form.tsx", root), "utf8"),
  ]);
  assert.match(migration, /REVOKE SELECT ON mailboxes FROM authenticated/i);
  assert.doesNotMatch(migration, /GRANT SELECT \([^)]*oauth_token/i);
  assert.match(migration, /status IN \('draft', 'queued', 'sending', 'sent', 'failed', 'cancelled'\)/i);
  assert.match(migration, /email\.reply\.queued/);
  assert.match(migration, /recovery\.delivery\.retry_queued/);
  assert.match(actions, /dashboard_create_email_reply_draft/);
  assert.match(actions, /dashboard_queue_email_reply/);
  assert.match(actions, /dashboard_retry_recovery_message/);
  assert.match(approvalControls, /window\.confirm/);
  assert.match(draftForm, /Saving creates a draft only/);
  assert.doesNotMatch(actions + approvalControls + draftForm, /SUPABASE_SERVICE_ROLE_KEY/);
});

test("renders the audit trail from tenant-scoped, append-only records", async () => {
  const [page, data, navigation, migration] = await Promise.all([
    readFile(new URL("app/dashboard/audit/page.tsx", root), "utf8"),
    readFile(new URL("lib/dashboard-data.ts", root), "utf8"),
    readFile(new URL("app/components/dashboard-nav.tsx", root), "utf8"),
    readFile(new URL("../database/migrations/006_dashboard_security_foundation.sql", root), "utf8"),
  ]);
  assert.match(page, /Append-only history/);
  assert.match(page, /safeMetadataKeys/);
  assert.doesNotMatch(page, /password|oauth_token|authorization|cookie/i);
  assert.match(data, /\.from\("audit_events"\)/);
  assert.match(data, /\.eq\("organization_id", organizationId\)/);
  assert.doesNotMatch(page + data, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(navigation, /\/dashboard\/audit/);
  assert.match(migration, /no UPDATE or DELETE policy: audit events are append-only/i);
});

test("keeps reply automations versioned, approval-gated, and server-executed", async () => {
  const [migration, actions, controls, page, engine] = await Promise.all([
    readFile(new URL("../database/migrations/011_reply_draft_automations.sql", root), "utf8"),
    readFile(new URL("app/dashboard/automations/actions.ts", root), "utf8"),
    readFile(new URL("app/components/workflow-controls.tsx", root), "utf8"),
    readFile(new URL("app/dashboard/automations/page.tsx", root), "utf8"),
    readFile(new URL("../src/outreach/engine.js", root), "utf8"),
  ]);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS automation_workflow_versions/i);
  assert.match(migration, /approval_mode\s+TEXT NOT NULL DEFAULT 'required' CHECK \(approval_mode = 'required'\)/i);
  assert.match(migration, /ONE_ACTIVE_REPLY|one_active_reply/i);
  assert.match(migration, /REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON automation_workflows[\s\S]*FROM authenticated, anon/i);
  assert.match(migration, /dashboard_has_org_role\(target_organization_id, ARRAY\['admin'\]\)/i);
  assert.match(migration, /REVOKE ALL ON FUNCTION enqueue_reply_automation\(UUID\) FROM PUBLIC, anon, authenticated/i);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION enqueue_reply_automation\(UUID\) TO service_role/i);
  assert.doesNotMatch(migration, /GRANT EXECUTE ON FUNCTION enqueue_reply_automation\(UUID\) TO authenticated/i);
  assert.match(migration, /INSERT INTO operator_email_replies[\s\S]*automation_run_id/i);
  assert.match(migration, /fail_reply_automation_run[\s\S]*AS \$\$\s*BEGIN[\s\S]*UPDATE automation_runs[\s\S]*END;\s*\$\$/i);
  assert.match(actions, /dashboard_create_reply_workflow/);
  assert.match(actions, /dashboard_update_reply_workflow/);
  assert.match(actions, /dashboard_set_workflow_status/);
  assert.match(controls, /window\.confirm/);
  assert.match(page, /No automatic sending/);
  assert.match(page, /Recent run history/);
  assert.match(engine, /processReplyAutomationRuns/);
  assert.doesNotMatch(actions + controls + page, /SUPABASE_SERVICE_ROLE_KEY/);
});

test("locks automation worker functions to the backend service role", async () => {
  const migration = await readFile(new URL("../database/migrations/012_lock_automation_worker_functions.sql", root), "utf8");
  for (const name of ["enqueue_reply_automation", "claim_reply_automation_run", "complete_reply_automation_run", "fail_reply_automation_run"]) {
    assert.match(migration, new RegExp(`REVOKE ALL ON FUNCTION ${name}\\([^;]+ FROM anon`, "i"));
    assert.match(migration, new RegExp(`REVOKE ALL ON FUNCTION ${name}\\([^;]+ FROM authenticated`, "i"));
    assert.match(migration, new RegExp(`GRANT EXECUTE ON FUNCTION ${name}\\([^;]+ TO service_role`, "i"));
  }
});

test("allows operators to edit drafts before approval without direct table writes", async () => {
  const [migration, actions, controls] = await Promise.all([
    readFile(new URL("../database/migrations/011_reply_draft_automations.sql", root), "utf8"),
    readFile(new URL("app/dashboard/approvals/actions.ts", root), "utf8"),
    readFile(new URL("app/components/approval-controls.tsx", root), "utf8"),
  ]);
  assert.match(migration, /dashboard_update_email_reply_draft/);
  assert.match(migration, /target\.status NOT IN \('draft', 'failed'\)/i);
  assert.match(actions, /\.rpc\("dashboard_update_email_reply_draft"/);
  assert.match(controls, /Edit draft/);
  assert.doesNotMatch(actions + controls, /\.from\("operator_email_replies"\)[\s\S]*\.(?:insert|update|delete)\(/);
});

test("supports tenant-guarded, audited skip and cancel approval decisions", async () => {
  const [migration, actions, controls, audit] = await Promise.all([
    readFile(new URL("../database/migrations/013_approval_dispositions.sql", root), "utf8"),
    readFile(new URL("app/dashboard/approvals/actions.ts", root), "utf8"),
    readFile(new URL("app/components/approval-controls.tsx", root), "utf8"),
    readFile(new URL("app/dashboard/audit/page.tsx", root), "utf8"),
  ]);
  assert.match(migration, /dashboard_is_org_member\(target_reply\.organization_id\)/i);
  assert.match(migration, /target_decision IS NULL OR target_decision NOT IN \('skip', 'cancel'\)/i);
  assert.match(migration, /status = 'cancelled'[\s\S]*queued_at = NULL/i);
  assert.match(migration, /resulting_run_status := CASE WHEN target_decision = 'skip' THEN 'stopped' ELSE 'cancelled' END/i);
  assert.match(migration, /INSERT INTO audit_events/i);
  assert.match(migration, /REVOKE ALL ON FUNCTION dashboard_dispose_email_reply\(UUID, TEXT\) FROM PUBLIC, anon, authenticated/i);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION dashboard_dispose_email_reply\(UUID, TEXT\) TO authenticated/i);
  assert.match(actions, /\.rpc\("dashboard_dispose_email_reply"/);
  assert.match(controls, /Skip reply/);
  assert.match(controls, /Cancel/);
  assert.match(controls, /window\.confirm/);
  assert.match(audit, /email\.reply\.skipped/);
  assert.match(audit, /email\.reply\.cancelled/);
  assert.doesNotMatch(actions + controls, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(actions + controls, /\.from\("operator_email_replies"\)[\s\S]*\.(?:insert|update|delete)\(/);
});

test("enforces an audited tenant-wide automation pause in every worker claim path", async () => {
  const [migration, actions, control, page, data, audit] = await Promise.all([
    readFile(new URL("../database/migrations/014_automation_runtime_controls.sql", root), "utf8"),
    readFile(new URL("app/dashboard/automations/actions.ts", root), "utf8"),
    readFile(new URL("app/components/automation-runtime-control.tsx", root), "utf8"),
    readFile(new URL("app/dashboard/automations/page.tsx", root), "utf8"),
    readFile(new URL("lib/dashboard-data.ts", root), "utf8"),
    readFile(new URL("app/dashboard/audit/page.tsx", root), "utf8"),
  ]);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS automation_runtime_controls/i);
  assert.match(migration, /globally_paused\s+BOOLEAN NOT NULL DEFAULT FALSE/i);
  assert.match(migration, /dashboard_has_org_role\(target_organization_id, ARRAY\['admin'\]\)/i);
  assert.match(migration, /automation_runs_block_while_paused/i);
  assert.match(migration, /claim_reply_automation_run[\s\S]*NOT EXISTS[\s\S]*globally_paused/i);
  assert.match(migration, /complete_reply_automation_run[\s\S]*globally_paused/i);
  assert.match(migration, /claim_operator_email_reply[\s\S]*automation_run_id IS NULL OR NOT EXISTS[\s\S]*globally_paused/i);
  assert.match(migration, /REVOKE ALL ON FUNCTION dashboard_set_automation_pause\(UUID, BOOLEAN, TEXT\) FROM PUBLIC, anon, authenticated/i);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION dashboard_set_automation_pause\(UUID, BOOLEAN, TEXT\) TO authenticated/i);
  assert.match(actions, /\.rpc\("dashboard_set_automation_pause"/);
  assert.match(control, /Pause all automations/);
  assert.match(control, /Reason for emergency pause/);
  assert.match(control, /window\.confirm/);
  assert.match(page, /Runtime status/);
  assert.match(control + page, /provider call already in flight/i);
  assert.match(page, /manual replies are unaffected/i);
  assert.match(data, /\.from\("automation_runtime_controls"\)/);
  assert.match(audit, /automation\.runtime\.paused/);
  assert.match(audit, /automation\.runtime\.resumed/);
  assert.doesNotMatch(actions + control + page + data, /SUPABASE_SERVICE_ROLE_KEY/);
});

test("shows tenant-scoped worker heartbeats without exposing raw provider errors", async () => {
  const [migration, engine, cron, scheduler, data, page] = await Promise.all([
    readFile(new URL("../database/migrations/015_automation_worker_heartbeats.sql", root), "utf8"),
    readFile(new URL("../src/outreach/engine.js", root), "utf8"),
    readFile(new URL("../api/cron/outreach.js", root), "utf8"),
    readFile(new URL("../src/scheduler.js", root), "utf8"),
    readFile(new URL("lib/dashboard-data.ts", root), "utf8"),
    readFile(new URL("app/dashboard/automations/page.tsx", root), "utf8"),
  ]);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS automation_worker_cycles/i);
  assert.match(migration, /dashboard_is_org_member\(organization_id\)/i);
  assert.match(migration, /failure_code[\s\S]*\^\[A-Za-z0-9_/i);
  assert.match(migration, /auth\.role\(\) IS DISTINCT FROM 'service_role'/i);
  assert.match(migration, /REVOKE ALL ON FUNCTION start_automation_worker_cycle\(UUID, TEXT\) FROM PUBLIC, anon, authenticated/i);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION finish_automation_worker_cycle\(UUID, TEXT, TEXT\) TO service_role/i);
  assert.match(engine, /runMonitoredOutreachCycle/);
  assert.match(engine, /workerFailureCode/);
  assert.match(cron + scheduler, /runMonitoredOutreachCycle/);
  assert.match(data, /\.from\("automation_worker_cycles"\)\.select\("status,failure_code,started_at,completed_at"\)/);
  assert.match(page, /Worker heartbeat/);
  assert.match(page, /heartbeat older than 30 minutes is marked stale/i);
  assert.doesNotMatch(page, /last_error|error\.message|SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(migration, /last_error|error_message/i);
});

test("atomically enforces audited tenant automation rate limits", async () => {
  const [migration, actions, control, data, page, audit] = await Promise.all([
    readFile(new URL("../database/migrations/016_automation_rate_limits.sql", root), "utf8"),
    readFile(new URL("app/dashboard/automations/actions.ts", root), "utf8"),
    readFile(new URL("app/components/automation-runtime-control.tsx", root), "utf8"),
    readFile(new URL("lib/dashboard-data.ts", root), "utf8"),
    readFile(new URL("app/dashboard/automations/page.tsx", root), "utf8"),
    readFile(new URL("app/dashboard/audit/page.tsx", root), "utf8"),
  ]);
  assert.match(migration, /hourly_run_limit INTEGER NOT NULL DEFAULT 100/i);
  assert.match(migration, /hourly_run_limit BETWEEN 1 AND 1000/i);
  assert.match(migration, /dashboard_has_org_role\(target_organization_id, ARRAY\['admin'\]\)/i);
  assert.match(migration, /SELECT \* INTO control[\s\S]*FOR UPDATE/i);
  assert.match(migration, /created_at >= NOW\(\) - INTERVAL '1 hour'/i);
  assert.match(migration, /automation\.run\.rate_limited/i);
  assert.match(migration, /IF NOT FOUND OR control\.globally_paused THEN RETURN NULL/i);
  assert.match(migration, /REVOKE ALL ON FUNCTION dashboard_set_automation_rate_limit\(UUID, INTEGER\) FROM PUBLIC, anon, authenticated/i);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION dashboard_set_automation_rate_limit\(UUID, INTEGER\) TO authenticated/i);
  assert.match(actions, /\.rpc\("dashboard_set_automation_rate_limit"/);
  assert.match(control, /Maximum automation runs per hour/);
  assert.match(page, /Hourly automation capacity/);
  assert.match(page, /<progress/);
  assert.match(data, /dashboard_automation_rate_limits_ready/);
  assert.match(data, /\.from\("automation_runs"\)\.select\("id", \{ count: "exact", head: true \}\)/);
  assert.match(audit, /automation\.runtime\.limit_changed/);
  assert.match(audit, /automation\.run\.rate_limited/);
  assert.doesNotMatch(actions + control + page + data, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(actions + control, /\.from\("automation_runtime_controls"\)[\s\S]*\.(?:insert|update|delete)\(/);
});

test("surfaces deduplicated automation failure alerts with audited acknowledgement", async () => {
  const [migration, actions, control, data, page, audit] = await Promise.all([
    readFile(new URL("../database/migrations/017_automation_failure_alerts.sql", root), "utf8"),
    readFile(new URL("app/dashboard/automations/actions.ts", root), "utf8"),
    readFile(new URL("app/components/automation-alert-control.tsx", root), "utf8"),
    readFile(new URL("lib/dashboard-data.ts", root), "utf8"),
    readFile(new URL("app/dashboard/automations/page.tsx", root), "utf8"),
    readFile(new URL("app/dashboard/audit/page.tsx", root), "utf8"),
  ]);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS automation_failure_alerts/i);
  assert.match(migration, /UNIQUE \(organization_id, source_type, source_id\)/i);
  assert.match(migration, /failure_code\s+TEXT NOT NULL CHECK \(failure_code ~ '\^\[A-Za-z0-9_/i);
  assert.match(migration, /automation_runs_create_failure_alert/i);
  assert.match(migration, /automation_worker_cycles_create_failure_alert/i);
  assert.match(migration, /ON CONFLICT \(organization_id, source_type, source_id\) DO UPDATE[\s\S]*acknowledged_at = NULL/i);
  assert.match(migration, /created_at >= NOW\(\) - INTERVAL '30 days'/i);
  assert.match(migration, /dashboard_is_org_member\(target\.organization_id\)/i);
  assert.match(migration, /automation\.alert\.acknowledged/i);
  assert.match(migration, /REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON automation_failure_alerts FROM authenticated, anon/i);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION dashboard_acknowledge_automation_alert\(UUID\) TO authenticated/i);
  assert.match(actions, /\.rpc\("dashboard_acknowledge_automation_alert"/);
  assert.match(control, /Acknowledge/);
  assert.match(data, /\.from\("automation_failure_alerts"\)/);
  assert.match(data, /\.is\("acknowledged_at", null\)/);
  assert.match(page, /Failure alerts/);
  assert.match(page, /does not retry or change failed work/i);
  assert.match(audit, /Failure alert acknowledged/);
  assert.doesNotMatch(page, /error\.message|SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(actions + control, /\.from\("automation_failure_alerts"\)[\s\S]*\.(?:insert|update|delete)\(/);
});
