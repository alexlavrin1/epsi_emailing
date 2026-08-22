import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseRouteClient } from "../../../../../lib/supabase-route";

export async function POST(request: NextRequest) {
  try {
    const { client, applyCookies } = createSupabaseRouteClient(request);
    const { data: userData } = await client.auth.getUser();
    if (!userData.user) return NextResponse.json({ error: "Sign in again to continue." }, { status: 401 });
    const { data: membership } = await client.from("organization_members").select("role").eq("user_id", userData.user.id).eq("status", "active").limit(1).maybeSingle();
    if (membership?.role !== "admin") return NextResponse.json({ error: "Administrator access is required." }, { status: 403 });

    const { data: factors } = await client.auth.mfa.listFactors();
    if (factors?.totp.length) return NextResponse.json({ error: "An authenticator is already enrolled. Refresh this page to verify it." }, { status: 409 });
    for (const factor of factors?.all.filter(item => item.factor_type === "totp" && item.status === "unverified") ?? []) {
      await client.auth.mfa.unenroll({ factorId: factor.id });
    }

    const { data, error } = await client.auth.mfa.enroll({ factorType: "totp", friendlyName: "EpsiFlow dashboard", issuer: "EpsiFlow" });
    if (error || !data) return NextResponse.json({ error: "Authenticator setup failed. Please try again." }, { status: 400 });
    return applyCookies(NextResponse.json({ factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret }));
  } catch {
    return NextResponse.json({ error: "Authentication is unavailable. Please try again." }, { status: 503 });
  }
}
