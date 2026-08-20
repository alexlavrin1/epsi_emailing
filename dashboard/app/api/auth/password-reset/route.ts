import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseRouteClient } from "../../../../lib/supabase-route";

function recoveryRedirect(request: NextRequest) {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  const origin = configured || request.nextUrl.origin;
  const url = new URL("/auth/callback", origin);
  url.searchParams.set("next", "/update-password");
  return url.toString();
}

export async function POST(request: NextRequest) {
  let body: { email?: unknown };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }

  try {
    // The SSR client uses PKCE and stores its verifier in an HTTP-only cookie.
    // The callback needs that verifier to exchange the emailed code for a session.
    const { client, applyCookies } = createSupabaseRouteClient(request);
    const { error } = await client.auth.resetPasswordForEmail(email, {
      redirectTo: recoveryRedirect(request),
    });
    if (error) {
      const rateLimited = error.status === 429 || error.code?.includes("rate_limit");
      console.error("Password reset request failed", { status: error.status, code: error.code });
      return NextResponse.json(
        { error: rateLimited ? "Too many reset emails were requested. Wait before trying again." : "We could not send the email. Please try again shortly." },
        { status: rateLimited ? 429 : 502 },
      );
    }

    // The same response is returned whether an account exists, preventing user enumeration.
    return applyCookies(NextResponse.json({ ok: true }));
  } catch {
    return NextResponse.json({ error: "Authentication is temporarily unavailable." }, { status: 503 });
  }
}
