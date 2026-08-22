import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseRouteClient } from "../../../../../lib/supabase-route";

export async function POST(request: NextRequest) {
  let body: { factorId?: unknown; code?: unknown };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }
  const factorId = typeof body.factorId === "string" ? body.factorId : "";
  const code = typeof body.code === "string" ? body.code.trim() : "";
  if (!factorId || !/^\d{6}$/.test(code)) return NextResponse.json({ error: "Enter the six-digit code from your authenticator app." }, { status: 400 });

  try {
    const { client, applyCookies } = createSupabaseRouteClient(request);
    const { data: userData } = await client.auth.getUser();
    if (!userData.user) return NextResponse.json({ error: "Sign in again to continue." }, { status: 401 });
    const { data: membership } = await client.from("organization_members").select("role").eq("user_id", userData.user.id).eq("status", "active").limit(1).maybeSingle();
    if (membership?.role !== "admin") return NextResponse.json({ error: "Administrator access is required." }, { status: 403 });
    const { data: factors } = await client.auth.mfa.listFactors();
    if (!factors?.all.some(factor => factor.id === factorId && factor.factor_type === "totp")) return NextResponse.json({ error: "Authenticator setup is no longer valid. Refresh and try again." }, { status: 400 });

    const { error } = await client.auth.mfa.challengeAndVerify({ factorId, code });
    if (error) return NextResponse.json({ error: "That code is incorrect or expired. Try the current code." }, { status: 400 });
    await client.rpc("dashboard_record_auth_event", { target_event_type: "auth.mfa.verified" });
    return applyCookies(NextResponse.json({ ok: true }));
  } catch {
    return NextResponse.json({ error: "Authentication is unavailable. Please try again." }, { status: 503 });
  }
}
