import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { getPublicSupabaseConfig } from "../../../../lib/env";

export async function POST(request: NextRequest) {
  const config = getPublicSupabaseConfig();
  const redirectUrl = new URL("/", request.url);
  if (!config) return NextResponse.redirect(redirectUrl, { status: 303 });
  const pendingCookies: Array<{ name: string; value: string; options: CookieOptions }> = [];
  const supabase = createServerClient(config.url, config.anonKey, {
    cookies: { getAll: () => request.cookies.getAll(), setAll: (values) => { pendingCookies.push(...values); } },
  });
  const { data: userData } = await supabase.auth.getUser();
  if (userData.user) {
    const { data: membership } = await supabase
      .from("organization_members")
      .select("organization_id")
      .eq("user_id", userData.user.id)
      .eq("status", "active")
      .limit(1)
      .maybeSingle();
    if (membership?.organization_id) {
      await supabase.from("audit_events").insert({
        organization_id: membership.organization_id,
        actor_user_id: userData.user.id,
        event_type: "auth.logout",
        metadata: { channel: "dashboard" },
      });
    }
  }
  await supabase.auth.signOut();
  const response = NextResponse.redirect(redirectUrl, { status: 303 });
  pendingCookies.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
  return response;
}
