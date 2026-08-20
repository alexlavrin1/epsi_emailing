import { createClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { requirePublicSupabaseConfig } from "../../../../lib/env";

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

  let config;
  try { config = requirePublicSupabaseConfig(); }
  catch { return NextResponse.json({ error: "Authentication has not been configured yet." }, { status: 503 }); }

  const supabase = createClient(config.url, config.anonKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: recoveryRedirect(request),
  });
  if (error) {
    return NextResponse.json({ error: "We could not send the email. Wait a moment and try again." }, { status: 429 });
  }

  // The same response is returned whether an account exists, preventing user enumeration.
  return NextResponse.json({ ok: true });
}
