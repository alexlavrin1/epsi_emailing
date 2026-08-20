import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseRouteClient } from "../../../../lib/supabase-route";

export async function POST(request: NextRequest) {
  let body: { password?: unknown };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }

  const password = typeof body.password === "string" ? body.password : "";
  if (password.length < 12) {
    return NextResponse.json({ error: "Use a password with at least 12 characters." }, { status: 400 });
  }

  try {
    const { client, applyCookies } = createSupabaseRouteClient(request);
    const { data: userData } = await client.auth.getUser();
    if (!userData.user) return NextResponse.json({ error: "This password link has expired. Request a new one." }, { status: 401 });

    const { error } = await client.auth.updateUser({ password });
    if (error) return NextResponse.json({ error: "The password could not be updated. Request a new link and try again." }, { status: 400 });

    const { data: membership } = await client
      .from("organization_members")
      .select("organization_id")
      .eq("user_id", userData.user.id)
      .eq("status", "active")
      .limit(1)
      .maybeSingle();
    if (membership?.organization_id) {
      await client.from("audit_events").insert({
        organization_id: membership.organization_id,
        actor_user_id: userData.user.id,
        event_type: "auth.password.updated",
        metadata: { channel: "dashboard_recovery" },
      });
    }

    await client.auth.signOut();
    return applyCookies(NextResponse.json({ ok: true }));
  } catch {
    return NextResponse.json({ error: "Authentication is unavailable. Please try again." }, { status: 503 });
  }
}
