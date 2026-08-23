import type { SupabaseClient } from "@supabase/supabase-js";

const defaultEngineUrl = "https://epsi-emailing.vercel.app";

export async function triggerClientWorkspaceSync(supabase: SupabaseClient, clientAppId: string) {
  const engineUrl = process.env.EPSIFLOW_ENGINE_URL?.trim() || defaultEngineUrl;
  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;
  if (!accessToken) return { completed: false };
  try {
    const response = await fetch(new URL("/api/client-sync", engineUrl), {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
      body: JSON.stringify({ client_app_id: clientAppId }),
      cache: "no-store",
      signal: AbortSignal.timeout(50_000),
    });
    return { completed: response.ok };
  } catch {
    return { completed: false };
  }
}
