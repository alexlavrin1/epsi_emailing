"use server";

import { revalidatePath } from "next/cache";
import { requireMembership } from "../../../lib/auth";
import { createSupabaseServerClient } from "../../../lib/supabase-server";

export type PlaybookActionState = { ok: boolean; message: string };
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const allowedStatuses = new Set(["none","incomplete","incomplete_expired","trialing","active","past_due","canceled","unpaid","paused"]);
const allowedTriggers = new Set(["manual_client_checkin","scheduled_checkin","stripe_cancellation","churn_reactivation"]);
const allowedVariables = new Set(["clientName","contactName","contactFirstName","subscriptionStatus","productName","billingInterval"]);

function validateTemplates(subject: string, body: string, channel: string) {
  if (!body || body.length > 10000) return "Body template must contain 1 to 10,000 characters.";
  if (channel === "email" && (!subject || subject.length > 998)) return "Email playbooks require a subject up to 998 characters.";
  const variables = [...`${subject}\n${body}`.matchAll(/\{\{([^}]+)\}\}/g)].map(match => match[1].trim());
  const unsupported = variables.find(variable => !allowedVariables.has(variable));
  return unsupported ? `Unsupported template variable: {{${unsupported}}}.` : null;
}

function playbookError(message?: string) {
  if (/schema cache|Could not find|does not exist/i.test(message || "")) return "Lead-aware client playbooks require migration 035.";
  if (/Administrator access/i.test(message || "")) return "Administrator access is required to configure playbooks.";
  if (/Pause the playbook before editing/i.test(message || "")) return "Pause this playbook before creating a new version.";
  if (/already exists/i.test(message || "")) return "A playbook with this name already exists.";
  return "Unable to update this playbook.";
}

function parseClientPlaybook(form: FormData): { agentPrompt: string } | { error: string } {
  const agentPrompt=String(form.get("agent_prompt")||"").trim();
  if (agentPrompt.length<20 || agentPrompt.length>12000) return { error:"AI instructions must contain 20 to 12,000 characters." } as const;
  return { agentPrompt } as const;
}

export async function createClientPlaybook(_state: PlaybookActionState, form: FormData): Promise<PlaybookActionState> {
  const { membership } = await requireMembership();
  if (!membership || membership.role !== "admin") return { ok: false, message: "Administrator access is required to configure playbooks." };
  const name = String(form.get("name") || "").trim(); const description = String(form.get("description") || "").trim();
  const channel = String(form.get("channel") || ""); const subject = String(form.get("subject_template") || "").trim(); const body = String(form.get("body_template") || "").trim();
  const statuses = form.getAll("eligible_statuses").map(String).filter(status => allowedStatuses.has(status));
  const trigger=String(form.get("trigger_type")||""); const segments=form.getAll("eligible_segments").map(String).filter(value=>["lead","epsiflow_direct","stripe_plan"].includes(value)); const relationships=form.getAll("eligible_relationships").map(String).filter(value=>["active","churned"].includes(value)); const cooldown=Number(form.get("cooldown_days")||30);
  const promptDefinition=parseClientPlaybook(form); if ("error" in promptDefinition) return { ok:false,message:promptDefinition.error };
  if (name.length < 3 || name.length > 120 || description.length > 500 || !["email","slack"].includes(channel) || !allowedTriggers.has(trigger) || !segments.length || !relationships.length || !Number.isInteger(cooldown) || cooldown<1 || cooldown>365) return { ok: false, message: "Enter valid playbook identity, trigger, audience, and cooldown conditions." };
  const templateError = validateTemplates(subject, body, channel); if (templateError) return { ok: false, message: templateError };
  const supabase = await createSupabaseServerClient(); if (!supabase) return { ok: false, message: "Playbooks are unavailable." };
  const { error } = await supabase.rpc("dashboard_create_client_playbook", { target_organization_id: membership.organization.id, target_name: name, target_description: description, target_channel: channel, target_trigger_type:trigger, target_eligible_statuses: statuses, target_eligible_segments:segments, target_eligible_relationships:relationships, target_cooldown_days:cooldown, target_subject_template: subject || null, target_body_template: body, target_agent_prompt:promptDefinition.agentPrompt });
  if (error) return { ok: false, message: playbookError(error.message) };
  revalidatePath("/dashboard/playbooks"); revalidatePath("/dashboard/audit");
  return { ok: true, message: "Playbook saved as a draft. Activate it when its conditions and wording are ready." };
}

export async function updateClientPlaybook(_state:PlaybookActionState,form:FormData):Promise<PlaybookActionState>{
  const {membership}=await requireMembership(); if(!membership||membership.role!=="admin") return {ok:false,message:"Administrator access is required to configure playbooks."};
  const playbookId=String(form.get("playbook_id")||""); const name=String(form.get("name")||"").trim(); const description=String(form.get("description")||"").trim(); const channel=String(form.get("channel")||""); const trigger=String(form.get("trigger_type")||""); const subject=String(form.get("subject_template")||"").trim(); const body=String(form.get("body_template")||"").trim(); const statuses=form.getAll("eligible_statuses").map(String).filter(status=>allowedStatuses.has(status)); const segments=form.getAll("eligible_segments").map(String).filter(value=>["lead","epsiflow_direct","stripe_plan"].includes(value)); const relationships=form.getAll("eligible_relationships").map(String).filter(value=>["active","churned"].includes(value)); const cooldown=Number(form.get("cooldown_days")||30); const promptDefinition=parseClientPlaybook(form);
  if(!uuidPattern.test(playbookId)||name.length<3||name.length>120||description.length>500||!["email","slack"].includes(channel)||!allowedTriggers.has(trigger)||!segments.length||!relationships.length||!Number.isInteger(cooldown)||cooldown<1||cooldown>365||"error" in promptDefinition) return {ok:false,message:"Enter a valid playbook definition and AI prompt."};
  const templateError=validateTemplates(subject,body,channel); if(templateError) return {ok:false,message:templateError}; const supabase=await createSupabaseServerClient(); if(!supabase)return {ok:false,message:"Playbooks are unavailable."};
  const {data,error}=await supabase.rpc("dashboard_update_client_playbook",{target_playbook_id:playbookId,target_name:name,target_description:description,target_channel:channel,target_trigger_type:trigger,target_eligible_statuses:statuses,target_eligible_segments:segments,target_eligible_relationships:relationships,target_cooldown_days:cooldown,target_subject_template:subject||null,target_body_template:body,target_agent_prompt:promptDefinition.agentPrompt});
  if(error)return {ok:false,message:playbookError(error.message)}; revalidatePath("/dashboard/playbooks"); revalidatePath("/dashboard/clients"); revalidatePath("/dashboard/audit"); return {ok:true,message:`Version ${data} saved. Existing drafts remain pinned to their original version.`};
}

export async function setClientPlaybookStatus(_state: PlaybookActionState, form: FormData): Promise<PlaybookActionState> {
  const { membership } = await requireMembership();
  if (!membership || membership.role !== "admin") return { ok: false, message: "Administrator access is required to configure playbooks." };
  const playbookId = String(form.get("playbook_id") || ""); const status = String(form.get("status") || "");
  if (!uuidPattern.test(playbookId) || !["active","paused"].includes(status)) return { ok: false, message: "Invalid playbook action." };
  const supabase = await createSupabaseServerClient(); if (!supabase) return { ok: false, message: "Playbooks are unavailable." };
  const { error } = await supabase.rpc("dashboard_set_client_playbook_status", { target_playbook_id: playbookId, target_status: status });
  if (error) return { ok: false, message: playbookError(error.message) };
  revalidatePath("/dashboard/playbooks"); revalidatePath("/dashboard/clients"); revalidatePath("/dashboard/audit");
  return { ok: true, message: status === "active" ? "Playbook activated. Manual playbooks are available on client pages; automatic playbooks can prepare approval drafts when scheduling is enabled." : "Playbook paused. Existing drafts remain reviewable." };
}
