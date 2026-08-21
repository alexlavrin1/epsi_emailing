"use server";

import { revalidatePath } from "next/cache";
import { requireMembership } from "../../../../../lib/auth";
import { createSupabaseServerClient } from "../../../../../lib/supabase-server";

export type ContactActionState = { ok: boolean; message: string };

const initialError: ContactActionState = { ok: false, message: "Unable to complete this action." };
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const lifecycleStages = new Set(["prospect", "interested", "client", "at_risk", "suppressed"]);

function contactFields(formData: FormData) {
  const kind = String(formData.get("kind") || "");
  const id = String(formData.get("id") || "");
  return { kind, id, valid: ["prospect", "customer"].includes(kind) && uuidPattern.test(id) };
}

function friendlyError(message?: string) {
  if (message?.includes("Could not find the function") || message?.includes("schema cache")) return "Operator actions are waiting for the Phase 3 database migration.";
  if (message?.includes("Not authorized")) return "You no longer have permission to modify this workspace.";
  return initialError.message;
}

export async function setLifecycleStage(_state: ContactActionState, formData: FormData): Promise<ContactActionState> {
  const { membership } = await requireMembership();
  if (!membership) return { ok: false, message: "An active organization membership is required." };
  const contact = contactFields(formData);
  const stage = String(formData.get("stage") || "");
  if (!contact.valid || !lifecycleStages.has(stage)) return { ok: false, message: "Choose a valid lifecycle stage." };
  const supabase = await createSupabaseServerClient();
  if (!supabase) return initialError;
  const { error } = await supabase.rpc("dashboard_set_lifecycle_stage", {
    target_organization_id: membership.organization.id,
    target_contact_kind: contact.kind,
    target_contact_id: contact.id,
    target_stage: stage,
  });
  if (error) return { ok: false, message: friendlyError(error.message) };
  revalidatePath(`/dashboard/crm/${contact.kind}/${contact.id}`);
  revalidatePath("/dashboard/pipeline");
  return { ok: true, message: "Lifecycle stage updated and recorded in the audit log." };
}

export async function addContactNote(_state: ContactActionState, formData: FormData): Promise<ContactActionState> {
  const { membership } = await requireMembership();
  if (!membership) return { ok: false, message: "An active organization membership is required." };
  const contact = contactFields(formData);
  const body = String(formData.get("body") || "").trim();
  if (!contact.valid || body.length < 1 || body.length > 4000) return { ok: false, message: "Enter a note between 1 and 4,000 characters." };
  const supabase = await createSupabaseServerClient();
  if (!supabase) return initialError;
  const { error } = await supabase.rpc("dashboard_add_contact_note", {
    target_organization_id: membership.organization.id,
    target_contact_kind: contact.kind,
    target_contact_id: contact.id,
    note_body: body,
  });
  if (error) return { ok: false, message: friendlyError(error.message) };
  revalidatePath(`/dashboard/crm/${contact.kind}/${contact.id}`);
  return { ok: true, message: "Note added and recorded in the audit log." };
}

export async function createContactTask(_state: ContactActionState, formData: FormData): Promise<ContactActionState> {
  const { membership } = await requireMembership();
  if (!membership) return { ok: false, message: "An active organization membership is required." };
  const contact = contactFields(formData);
  const title = String(formData.get("title") || "").trim();
  const dueDate = String(formData.get("due_date") || "");
  if (!contact.valid || title.length < 1 || title.length > 200) return { ok: false, message: "Enter a task title between 1 and 200 characters." };
  if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return { ok: false, message: "Choose a valid due date." };
  const supabase = await createSupabaseServerClient();
  if (!supabase) return initialError;
  const { error } = await supabase.rpc("dashboard_create_contact_task", {
    target_organization_id: membership.organization.id,
    target_contact_kind: contact.kind,
    target_contact_id: contact.id,
    task_title: title,
    task_due_at: dueDate ? `${dueDate}T12:00:00.000Z` : null,
  });
  if (error) return { ok: false, message: friendlyError(error.message) };
  revalidatePath(`/dashboard/crm/${contact.kind}/${contact.id}`);
  return { ok: true, message: "Task created and recorded in the audit log." };
}

export async function setContactTaskStatus(_state: ContactActionState, formData: FormData): Promise<ContactActionState> {
  const { membership } = await requireMembership();
  if (!membership) return { ok: false, message: "An active organization membership is required." };
  const contact = contactFields(formData);
  const taskId = String(formData.get("task_id") || "");
  const status = String(formData.get("status") || "");
  if (!contact.valid || !uuidPattern.test(taskId) || !["open", "completed"].includes(status)) return initialError;
  const supabase = await createSupabaseServerClient();
  if (!supabase) return initialError;
  const { error } = await supabase.rpc("dashboard_set_contact_task_status", { target_task_id: taskId, target_status: status });
  if (error) return { ok: false, message: friendlyError(error.message) };
  revalidatePath(`/dashboard/crm/${contact.kind}/${contact.id}`);
  return { ok: true, message: status === "completed" ? "Task completed." : "Task reopened." };
}
