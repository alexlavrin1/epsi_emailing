"use server";

import { revalidatePath } from "next/cache";
import { requireMembership } from "../../../lib/auth";
import { createSupabaseServerClient } from "../../../lib/supabase-server";
import { triggerClientPlaybookGeneration } from "../../../lib/client-playbook-generation";

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

export async function updateClientPlaybookDraft(_state: ApprovalActionState, formData: FormData): Promise<ApprovalActionState> {
  const { membership } = await requireMembership(); if (!membership) return { ok: false, message: "An active organization membership is required." };
  const draftId = String(formData.get("draft_id") || ""); const subject = String(formData.get("subject") || "").trim(); const body = String(formData.get("body") || "").trim();
  if (!uuidPattern.test(draftId) || !body || body.length > 10000 || subject.length > 998) return { ok: false, message: "Enter a valid subject and message." };
  const supabase = await createSupabaseServerClient(); if (!supabase) return { ok: false, message: "Unable to update this draft." };
  const { error } = await supabase.rpc("dashboard_update_client_playbook_draft", { target_draft_id: draftId, target_subject: subject || null, target_body: body });
  if (error) return { ok: false, message: /schema cache|Could not find|does not exist/i.test(error.message) ? "Client playbooks require migration 030." : "Unable to update this draft." };
  revalidatePath("/dashboard/approvals"); revalidatePath("/dashboard/audit");
  return { ok: true, message: "Draft updated. Nothing has been sent." };
}

export async function decideClientPlaybookDraft(_state: ApprovalActionState, formData: FormData): Promise<ApprovalActionState> {
  const { membership } = await requireMembership(); if (!membership) return { ok: false, message: "An active organization membership is required." };
  const draftId = String(formData.get("draft_id") || ""); const decision = String(formData.get("decision") || "");
  if (!uuidPattern.test(draftId) || !["approve","cancel"].includes(decision)) return { ok: false, message: "Invalid draft decision." };
  const supabase = await createSupabaseServerClient(); if (!supabase) return { ok: false, message: "Unable to record this decision." };
  const { error } = await supabase.rpc("dashboard_decide_client_playbook_draft", { target_draft_id: draftId, target_decision: decision });
  if (error) return { ok: false, message: /schema cache|Could not find|does not exist/i.test(error.message) ? "Email delivery requires migration 042." : "Unable to record this decision." };
  revalidatePath("/dashboard/approvals"); revalidatePath("/dashboard/audit");
  const channel = String(formData.get("channel") || "");
  return { ok: true, message: decision === "approve" ? (channel === "email" ? "Email approved and queued for the backend delivery worker." : "Draft approved as ready. Slack was not sent.") : "Draft cancelled. Nothing was sent." };
}

export async function regenerateClientPlaybookAgentDraft(_state: ApprovalActionState, formData: FormData): Promise<ApprovalActionState> {
  const { membership } = await requireMembership(); if (!membership) return { ok: false, message: "An active organization membership is required." };
  const draftId = String(formData.get("draft_id") || "");
  const clientAppId = String(formData.get("client_app_id") || "");
  const feedback = String(formData.get("feedback") || "").trim();
  if (!uuidPattern.test(draftId) || !uuidPattern.test(clientAppId) || feedback.length > 4000) return { ok: false, message: "Feedback must be no more than 4,000 characters." };
  const supabase = await createSupabaseServerClient(); if (!supabase) return { ok: false, message: "Unable to regenerate this AI draft." };
  const { error } = await supabase.rpc("dashboard_regenerate_client_playbook_agent_draft", { target_draft_id: draftId, target_feedback: feedback || null });
  if (error) return { ok: false, message: /schema cache|Could not find|does not exist/i.test(error.message) ? "AI regeneration requires migration 039." : "Unable to regenerate this AI draft." };
  const immediate = await triggerClientPlaybookGeneration(supabase, draftId, clientAppId);
  revalidatePath("/dashboard/approvals"); revalidatePath("/dashboard/audit");
  if (immediate.completed) return { ok: true, message: "AI draft regenerated with your feedback. Review the replacement below; nothing was sent." };
  if (immediate.errorCode === "client_agent_immediate_claim_unavailable") return { ok: false, message: "Immediate AI generation is not installed on the backend. Apply migration 041, redeploy the engine, and retry." };
  if (immediate.errorCode === "client_agent_disabled") return { ok: false, message: "Immediate AI generation is disabled on the backend. Set CLIENT_SUCCESS_AGENT_ENABLED=true and redeploy the engine." };
  if (immediate.errorCode === "client_agent_draft_not_claimed") return { ok: false, message: "The selected draft could not start immediately. Apply migration 041, confirm automations are not globally paused, and retry." };
  return { ok: false, message: `AI generation ran immediately but did not complete (${immediate.errorCode || "client_agent_immediate_request_failed"}). The draft was not sent.` };
}
