import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { requirePublicSupabaseConfig } from "../../../../lib/env";

type PendingCookie = { name: string; value: string; options: CookieOptions };

export async function POST(request: NextRequest) {
  let body: { email?: unknown; password?: unknown };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!email || !password) return NextResponse.json({ error: "Email and password are required." }, { status: 400 });

  let config;
  try { config = requirePublicSupabaseConfig(); }
  catch { return NextResponse.json({ error: "Authentication has not been configured yet." }, { status: 503 }); }

  const pendingCookies: PendingCookie[] = [];
  const supabase = createServerClient(config.url, config.anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (values) => { pendingCookies.push(...values); },
    },
  });
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) return NextResponse.json({ error: "The email or password is incorrect." }, { status: 401 });

  const { data: membership } = await supabase
    .from("organization_members")
    .select("organization_id,role")
    .eq("user_id", data.user.id)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();
  if (membership?.organization_id) {
    await supabase.from("audit_events").insert({
      organization_id: membership.organization_id,
      actor_user_id: data.user.id,
      event_type: "auth.login.succeeded",
      metadata: { channel: "dashboard" },
    });
  }

  const { data: assurance } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  const requiresMfa = membership?.role === "admin" && assurance?.currentLevel !== "aal2";
  const response = NextResponse.json({ ok: true, requiresMfa });
  pendingCookies.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
  return response;
}
