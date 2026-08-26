import type { SupabaseClient } from "@supabase/supabase-js";

const defaultEngineUrl = "https://epsi-emailing.vercel.app";

export async function triggerClientPlaybookGeneration(supabase: SupabaseClient, draftId: string, clientAppId: string) {
  const engineUrl = process.env.EPSIFLOW_ENGINE_URL?.trim() || defaultEngineUrl;
  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;
  if (!accessToken) return { completed: false, errorCode: "dashboard_session_missing" };
  try {
    const response = await fetch(new URL("/api/client-playbook-generate", engineUrl), {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
      body: JSON.stringify({ draft_id: draftId, client_app_id: clientAppId }),
      cache: "no-store",
      signal: AbortSignal.timeout(55_000),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const candidate = String(payload?.code || "client_agent_immediate_request_failed");
      const errorCode = /^[a-z0-9_.:-]{1,100}$/i.test(candidate) ? candidate : "client_agent_immediate_request_failed";
      return { completed: false, errorCode };
    }
    return { completed: payload?.result?.completed === 1, errorCode: null };
  } catch {
    return { completed: false, errorCode: "client_agent_immediate_request_failed" };
  }
}
