"use server";

import { revalidatePath } from "next/cache";
import { requireMembership } from "../../../lib/auth";
import { createSupabaseServerClient } from "../../../lib/supabase-server";

export type WorkflowActionState = { ok: boolean; message: string };
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const allowedVariables = new Set(["firstName", "lastName", "company", "email", "subject"]);

type ValidDefinition = { name: string; description: string; body: string; delay: number };

function validateDefinition(formData: FormData): ValidDefinition | { error: string } {
  const name = String(formData.get("name") || "").trim();
  const description = String(formData.get("description") || "").trim();
  const body = String(formData.get("body_template") || "").trim();
  const delay = Number(formData.get("delay_minutes"));
  if (name.length < 3 || name.length > 120) return { error: "Name must contain 3 to 120 characters." } as const;
  if (description.length > 500) return { error: "Description cannot exceed 500 characters." } as const;
  if (!body || body.length > 10000) return { error: "Template must contain 1 to 10,000 characters." } as const;
  if (!Number.isInteger(delay) || delay < 0 || delay > 10080) return { error: "Delay must be between 0 and 10,080 minutes." } as const;
  const variables = [...body.matchAll(/\{\{([^}]+)\}\}/g)].map(match => match[1].trim());
  const unsupported = variables.find(variable => !allowedVariables.has(variable));
  if (unsupported) return { error: `Unsupported template variable: {{${unsupported}}}.` } as const;
  return { name, description, body, delay } as const;
}

function actionError(message?: string) {
  if (/schema cache|Could not find|does not exist/i.test(message || "")) return "Automation controls require migration 011.";
  if (/Administrator access required/i.test(message || "")) return "Administrator access is required to configure workflows.";
  if (/Another workflow already handles/i.test(message || "")) return "Pause the active reply workflow before activating another one.";
  if (/Pause the workflow before editing/i.test(message || "")) return "Pause this workflow before creating a new version.";
  if (/duplicate key|automation_workflows_organization_id_name_key/i.test(message || "")) return "A workflow with this name already exists.";
  return "Unable to update this workflow.";
}

async function adminContext() {
  const { membership } = await requireMembership();
  if (!membership || membership.role !== "admin") return null;
  const supabase = await createSupabaseServerClient();
  return supabase ? { membership, supabase } : null;
}

export async function createReplyWorkflow(_state: WorkflowActionState, formData: FormData): Promise<WorkflowActionState> {
  const context = await adminContext();
  if (!context) return { ok: false, message: "Administrator access is required to configure workflows." };
  const definition = validateDefinition(formData);
  if ("error" in definition) return { ok: false, message: definition.error };
  const { error } = await context.supabase.rpc("dashboard_create_reply_workflow", {
    target_organization_id: context.membership.organization.id,
    workflow_name: definition.name,
    workflow_description: definition.description,
    workflow_body_template: definition.body,
    workflow_delay_minutes: definition.delay,
  });
  if (error) return { ok: false, message: actionError(error.message) };
  revalidatePath("/dashboard/automations"); revalidatePath("/dashboard/audit");
  return { ok: true, message: "Workflow saved as a draft. Review it, then activate it when ready." };
}

export async function updateReplyWorkflow(_state: WorkflowActionState, formData: FormData): Promise<WorkflowActionState> {
  const context = await adminContext();
  if (!context) return { ok: false, message: "Administrator access is required to configure workflows." };
  const workflowId = String(formData.get("workflow_id") || "");
  const definition = validateDefinition(formData);
  if (!uuidPattern.test(workflowId) || "error" in definition) return { ok: false, message: "Enter a valid workflow definition." };
  const { data, error } = await context.supabase.rpc("dashboard_update_reply_workflow", {
    target_workflow_id: workflowId,
    workflow_name: definition.name,
    workflow_description: definition.description,
    workflow_body_template: definition.body,
    workflow_delay_minutes: definition.delay,
  });
  if (error) return { ok: false, message: actionError(error.message) };
  revalidatePath("/dashboard/automations"); revalidatePath("/dashboard/audit");
  return { ok: true, message: `Version ${data} saved. Existing runs remain pinned to their original version.` };
}

export async function setWorkflowStatus(_state: WorkflowActionState, formData: FormData): Promise<WorkflowActionState> {
  const context = await adminContext();
  if (!context) return { ok: false, message: "Administrator access is required to configure workflows." };
  const workflowId = String(formData.get("workflow_id") || "");
  const status = String(formData.get("status") || "");
  if (!uuidPattern.test(workflowId) || !["active", "paused"].includes(status)) return { ok: false, message: "Invalid workflow action." };
  const { error } = await context.supabase.rpc("dashboard_set_workflow_status", { target_workflow_id: workflowId, target_status: status });
  if (error) return { ok: false, message: actionError(error.message) };
  revalidatePath("/dashboard/automations"); revalidatePath("/dashboard/audit");
  return { ok: true, message: status === "active" ? "Workflow activated. New replies can now prepare approval-gated drafts." : "Workflow paused. Queued runs will remain stopped until it is reactivated." };
}

export async function setAutomationRuntimePause(_state: WorkflowActionState, formData: FormData): Promise<WorkflowActionState> {
  const context = await adminContext();
  if (!context) return { ok: false, message: "Administrator access is required to control the automation runtime." };
  const paused = String(formData.get("paused") || "");
  const reason = String(formData.get("reason") || "").trim();
  if (!["true", "false"].includes(paused)) return { ok: false, message: "Invalid runtime action." };
  if (paused === "true" && (reason.length < 3 || reason.length > 500)) return { ok: false, message: "Enter a pause reason between 3 and 500 characters." };
  const targetPaused = paused === "true";
  const { error } = await context.supabase.rpc("dashboard_set_automation_pause", {
    target_organization_id: context.membership.organization.id,
    target_paused: targetPaused,
    target_reason: targetPaused ? reason : null,
  });
  if (error) return { ok: false, message: /schema cache|Could not find|does not exist/i.test(error.message) ? "Global runtime controls require migration 014." : actionError(error.message) };
  revalidatePath("/dashboard/automations"); revalidatePath("/dashboard/audit");
  return { ok: true, message: targetPaused ? "All automations paused. Queued work is preserved but cannot be claimed." : "Automations resumed. Queued work can continue on the next worker cycle." };
}
