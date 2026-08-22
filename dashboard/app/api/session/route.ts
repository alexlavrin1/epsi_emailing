import { NextResponse } from "next/server";
import { getCurrentUser, getMembership } from "../../../lib/auth";
import { createSupabaseServerClient } from "../../../lib/supabase-server";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const membership = await getMembership(user.id);
  if (!membership) return NextResponse.json({ error: "Access pending" }, { status: 403 });
  if (membership.role === "admin") {
    const supabase = await createSupabaseServerClient();
    const { data } = supabase ? await supabase.auth.mfa.getAuthenticatorAssuranceLevel() : { data: null };
    if (data?.currentLevel !== "aal2") return NextResponse.json({ error: "Multi-factor authentication required" }, { status: 403 });
  }
  return NextResponse.json({ user: { id: user.id, email: user.email }, organization: membership.organization, role: membership.role });
}
