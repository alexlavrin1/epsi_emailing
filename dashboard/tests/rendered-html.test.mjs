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
  const migration = await readFile(new URL("../database/migrations/006_dashboard_security_foundation.sql", root), "utf8");
  assert.match(migration, /ALTER TABLE organizations ENABLE ROW LEVEL SECURITY/i);
  assert.match(migration, /CREATE POLICY audit_actor_insert/i);
  assert.doesNotMatch(migration, /CREATE POLICY audit_.*(?:UPDATE|DELETE)/i);
  assert.match(migration, /dashboard_is_org_member/i);
  assert.match(migration, /dashboard_assign_single_organization/i);
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
