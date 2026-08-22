"use server";

import { revalidatePath } from "next/cache";
import { requireMembership } from "../../../lib/auth";
import { createSupabaseServerClient } from "../../../lib/supabase-server";

export type ApprovalActionState = { ok: boolean; message: string };
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function setupError(message?: string) {
  return message?.includes("schema cache") || message?.includes("Could not find") ? "Approval controls require migration 009." : "Unable to complete this action.";
}

export async function createReplyDraft(_state: ApprovalActionState, formData: FormData): Promise<ApprovalActionState> {
  const { membership } = await requireMembership();
  if (!membership) return { ok: false, message: "An active organization membership is required." };
  const replyId = String(formData.get("prospect_reply_id") || "");
  const body = String(formData.get("body") || "").trim();
  if (!uuidPattern.test(replyId) || body.length < 1 || body.length > 10000) return { ok: false, message: "Enter a reply between 1 and 10,000 characters." };
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { ok: false, message: "Unable to save this draft." };
  const { error } = await supabase.rpc("dashboard_create_email_reply_draft", { target_organization_id: membership.organization.id, target_prospect_reply_id: replyId, reply_body: body });
  if (error) return { ok: false, message: setupError(error.message) };
  revalidatePath("/dashboard/inbox"); revalidatePath("/dashboard/approvals");
  return { ok: true, message: "Draft saved. Review and approve it before anything is sent." };
}

export async function queueReply(_state: ApprovalActionState, formData: FormData): Promise<ApprovalActionState> {
  const { membership } = await requireMembership();
  if (!membership) return { ok: false, message: "An active organization membership is required." };
  const replyId = String(formData.get("reply_id") || "");
  if (!uuidPattern.test(replyId)) return { ok: false, message: "Invalid reply draft." };
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { ok: false, message: "Unable to queue this reply." };
  const { error } = await supabase.rpc("dashboard_queue_email_reply", { target_reply_id: replyId });
  if (error) return { ok: false, message: setupError(error.message) };
  revalidatePath("/dashboard/approvals");
  return { ok: true, message: "Reply approved and queued for the backend delivery worker." };
}

export async function updateReplyDraft(_state: ApprovalActionState, formData: FormData): Promise<ApprovalActionState> {
  const { membership } = await requireMembership();
  if (!membership) return { ok: false, message: "An active organization membership is required." };
  const replyId = String(formData.get("reply_id") || "");
  const body = String(formData.get("body") || "").trim();
  if (!uuidPattern.test(replyId) || body.length < 1 || body.length > 10000) return { ok: false, message: "Enter a reply between 1 and 10,000 characters." };
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { ok: false, message: "Unable to update this draft." };
  const { error } = await supabase.rpc("dashboard_update_email_reply_draft", { target_reply_id: replyId, reply_body: body });
  if (error) return { ok: false, message: /schema cache|Could not find/i.test(error.message) ? "Draft editing requires migration 011." : "Unable to update this draft." };
  revalidatePath("/dashboard/approvals"); revalidatePath("/dashboard/automations"); revalidatePath("/dashboard/audit");
  return { ok: true, message: "Draft updated. Review the final text before approving it." };
}

export async function disposeReply(_state: ApprovalActionState, formData: FormData): Promise<ApprovalActionState> {
  const { membership } = await requireMembership();
  if (!membership) return { ok: false, message: "An active organization membership is required." };
  const replyId = String(formData.get("reply_id") || "");
  const decision = String(formData.get("decision") || "");
  if (!uuidPattern.test(replyId) || !["skip", "cancel"].includes(decision)) return { ok: false, message: "Invalid reply decision." };
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { ok: false, message: "Unable to close this draft." };
  const { error } = await supabase.rpc("dashboard_dispose_email_reply", { target_reply_id: replyId, target_decision: decision });
  if (error) return { ok: false, message: /schema cache|Could not find|does not exist/i.test(error.message) ? "Skip and cancel controls require migration 013." : "Unable to close this draft." };
  revalidatePath("/dashboard/approvals"); revalidatePath("/dashboard/automations"); revalidatePath("/dashboard/audit");
  return { ok: true, message: decision === "skip" ? "Reply skipped. Nothing will be sent." : "Reply cancelled. Nothing will be sent." };
}

export async function retryRecoveryMessage(_state: ApprovalActionState, formData: FormData): Promise<ApprovalActionState> {
  const { membership } = await requireMembership();
  if (!membership) return { ok: false, message: "An active organization membership is required." };
  const messageId = String(formData.get("message_id") || "");
  if (!uuidPattern.test(messageId)) return { ok: false, message: "Invalid recovery message." };
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { ok: false, message: "Unable to queue this retry." };
  const { error } = await supabase.rpc("dashboard_retry_recovery_message", { target_organization_id: membership.organization.id, target_message_id: messageId });
  if (error) return { ok: false, message: setupError(error.message) };
  revalidatePath("/dashboard/approvals"); revalidatePath("/dashboard"); revalidatePath("/dashboard/pipeline");
  return { ok: true, message: "Retry queued. The recovery worker will revalidate the case before delivery." };
}
