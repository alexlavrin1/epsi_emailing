import { NextResponse } from "next/server";
import { getCurrentUser, getMembership } from "../../../lib/auth";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const membership = await getMembership(user.id);
  if (!membership) return NextResponse.json({ error: "Access pending" }, { status: 403 });
  return NextResponse.json({ user: { id: user.id, email: user.email }, organization: membership.organization, role: membership.role });
}
