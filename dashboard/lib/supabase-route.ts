import { createServerClient, type CookieOptions } from "@supabase/ssr";
import type { NextRequest, NextResponse } from "next/server";
import { requirePublicSupabaseConfig } from "./env";

type PendingCookie = { name: string; value: string; options: CookieOptions };

export function createSupabaseRouteClient(request: NextRequest) {
  const config = requirePublicSupabaseConfig();
  const pendingCookies: PendingCookie[] = [];
  const client = createServerClient(config.url, config.anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (values) => { pendingCookies.push(...values); },
    },
  });
  return {
    client,
    applyCookies(response: NextResponse) {
      pendingCookies.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      return response;
    },
  };
}
