import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseRouteClient } from "../../../lib/supabase-route";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const requestedNext = request.nextUrl.searchParams.get("next");
  const next = requestedNext === "/update-password" ? requestedNext : "/dashboard";
  if (!code) return NextResponse.redirect(new URL("/forgot-password?error=missing-code", request.url));

  try {
    const { client, applyCookies } = createSupabaseRouteClient(request);
    const { error } = await client.auth.exchangeCodeForSession(code);
    if (error) throw error;
    return applyCookies(NextResponse.redirect(new URL(next, request.url)));
  } catch {
    return NextResponse.redirect(new URL("/forgot-password?error=invalid-code", request.url));
  }
}
