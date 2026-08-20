import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function render(pathname = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${pathname}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request(`http://localhost${pathname}`, { headers: { accept: "text/html" }, redirect: "manual" }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
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

test("defines tenant RLS and an append-only audit log", async () => {
  const migration = await readFile(new URL("../database/migrations/006_dashboard_security_foundation.sql", root), "utf8");
  assert.match(migration, /ALTER TABLE organizations ENABLE ROW LEVEL SECURITY/i);
  assert.match(migration, /CREATE POLICY audit_actor_insert/i);
  assert.doesNotMatch(migration, /CREATE POLICY audit_.*(?:UPDATE|DELETE)/i);
  assert.match(migration, /dashboard_is_org_member/i);
  assert.match(migration, /dashboard_assign_single_organization/i);
});
