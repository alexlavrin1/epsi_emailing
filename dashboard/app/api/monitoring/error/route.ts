import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseRouteClient } from "../../../../lib/supabase-route";
export async function POST(request: NextRequest) {
  try {
    const { client, applyCookies } = createSupabaseRouteClient(request);
    const { data: userData } = await client.auth.getUser();
    if (!userData.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { data: membership } = await client.from("organization_members").select("organization_id").eq("user_id", userData.user.id).eq("status", "active").limit(1).maybeSingle();
    if (!membership?.organization_id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const { error } = await client.rpc("dashboard_record_render_error", { target_organization_id: membership.organization_id });
    if (error) return NextResponse.json({ error: "Monitoring unavailable" }, { status: 503 });
    return applyCookies(new NextResponse(null, { status: 204, headers: { "cache-control": "no-store" } }));
  } catch { return NextResponse.json({ error: "Monitoring unavailable" }, { status: 503 }); }
}
