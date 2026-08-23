import type { SupabaseClient } from "@supabase/supabase-js";

export type ClientPlaybook = {
  id: string; name: string; description: string; channel: "email" | "slack";
  eligibleStatuses: string[]; status: "draft" | "active" | "paused";
  currentVersion: number; subjectTemplate: string | null; bodyTemplate: string;
  versions: number; updatedAt: string;
};

export async function getClientPlaybooks(supabase: SupabaseClient, organizationId: string) {
  const readiness = await supabase.rpc("dashboard_client_playbooks_ready");
  if (readiness.error || readiness.data !== true) return { ready: false, playbooks: [] as ClientPlaybook[] };
  const { data, error } = await supabase.from("client_playbooks")
    .select("id,name,description,channel,eligible_subscription_statuses,status,current_version,updated_at,versions:client_playbook_versions(version,subject_template,body_template)")
    .eq("organization_id", organizationId).order("updated_at", { ascending: false }).limit(100);
  if (error) return { ready: false, playbooks: [] as ClientPlaybook[] };
  const playbooks = (data ?? []).map(row => {
    const versions = (row.versions ?? []) as Array<{ version: number; subject_template: string | null; body_template: string }>;
    const current = versions.find(version => version.version === row.current_version) || versions[0];
    return { id: row.id, name: row.name, description: row.description, channel: row.channel as ClientPlaybook["channel"], eligibleStatuses: row.eligible_subscription_statuses || [], status: row.status as ClientPlaybook["status"], currentVersion: row.current_version, subjectTemplate: current?.subject_template ?? null, bodyTemplate: current?.body_template || "", versions: versions.length, updatedAt: row.updated_at };
  });
  return { ready: true, playbooks };
}

export async function getActiveClientPlaybooks(supabase: SupabaseClient, organizationId: string) {
  const result = await getClientPlaybooks(supabase, organizationId);
  return { ready: result.ready, playbooks: result.playbooks.filter(playbook => playbook.status === "active") };
}

