import type { SupabaseClient } from "@supabase/supabase-js";

export type ClientPlaybook = {
  kind: "client";
  id: string; name: string; description: string; channel: "email" | "slack";
  eligibleStatuses: string[]; status: "draft" | "active" | "paused";
  currentVersion: number; subjectTemplate: string | null; bodyTemplate: string;
  versions: number; updatedAt: string;
  triggerType: string; eligibleSegments: string[]; eligibleRelationships: string[]; cooldownDays: number;
  agentPrompt: string; presetKey: string | null;
};

export type LeadPlaybook = {
  kind: "lead"; id: string; name: string; description: string; channel: "email";
  status: "draft" | "active" | "paused"; currentVersion: number; versions: number; updatedAt: string;
  triggerType: "prospect_reply_received"; delayMinutes: number; bodyTemplate: string; agentPrompt: string; presetKey: string | null;
};

export type ManagedPlaybook = ClientPlaybook | LeadPlaybook;

export async function getClientPlaybooks(supabase: SupabaseClient, organizationId: string) {
  const readiness = await supabase.rpc("dashboard_epsiflow_playbook_library_ready");
  if (readiness.error || readiness.data !== true) return { ready: false, playbooks: [] as ManagedPlaybook[] };
  const [clients, leads] = await Promise.all([
    supabase.from("client_playbooks")
      .select("id,name,description,channel,trigger_type,eligible_subscription_statuses,eligible_client_segments,eligible_relationship_states,cooldown_days,status,current_version,updated_at,preset_key,versions:client_playbook_versions(version,subject_template,body_template,agent_prompt)")
      .eq("organization_id", organizationId).order("updated_at", { ascending: false }).limit(100),
    supabase.from("automation_workflows")
      .select("id,name,description,status,trigger_type,delay_minutes,current_version,updated_at,preset_key,versions:automation_workflow_versions(version,body_template,agent_prompt)")
      .eq("organization_id", organizationId).not("preset_key", "is", null).neq("preset_key", "lead_education_reply").order("updated_at", { ascending: false }).limit(100),
  ]);
  if (clients.error || leads.error) return { ready: false, playbooks: [] as ManagedPlaybook[] };
  const playbooks: ManagedPlaybook[] = (clients.data ?? []).map(row => {
    const versions = (row.versions ?? []) as Array<{ version: number; subject_template: string | null; body_template: string; agent_prompt: string }>;
    const current = versions.find(version => version.version === row.current_version) || versions[0];
    return { kind:"client", id: row.id, name: row.name, description: row.description, channel: row.channel as ClientPlaybook["channel"], triggerType:row.trigger_type, eligibleStatuses: row.eligible_subscription_statuses || [], eligibleSegments:row.eligible_client_segments||[], eligibleRelationships:row.eligible_relationship_states||[], cooldownDays:row.cooldown_days, status: row.status as ClientPlaybook["status"], currentVersion: row.current_version, subjectTemplate: current?.subject_template ?? null, bodyTemplate: current?.body_template || "", agentPrompt: current?.agent_prompt || "", presetKey: row.preset_key, versions: versions.length, updatedAt: row.updated_at };
  });
  for (const row of leads.data ?? []) {
    const versions = (row.versions ?? []) as Array<{ version: number; body_template: string; agent_prompt: string }>;
    const current = versions.find(version => version.version === row.current_version) || versions[0];
    playbooks.push({ kind:"lead", id:row.id, name:row.name, description:row.description, channel:"email", status:row.status as LeadPlaybook["status"], currentVersion:row.current_version, versions:versions.length, updatedAt:row.updated_at, triggerType:"prospect_reply_received", delayMinutes:row.delay_minutes, bodyTemplate:current?.body_template||"", agentPrompt:current?.agent_prompt||"", presetKey:row.preset_key });
  }
  return { ready: true, playbooks };
}

export async function getActiveClientPlaybooks(supabase: SupabaseClient, organizationId: string) {
  const result = await getClientPlaybooks(supabase, organizationId);
  return { ready: result.ready, playbooks: result.playbooks.filter((playbook): playbook is ClientPlaybook => playbook.kind === "client" && playbook.status === "active" && playbook.triggerType === "manual_client_checkin") };
}
