"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireMembership } from "../../../lib/auth";
import { createSupabaseServerClient } from "../../../lib/supabase-server";
import { triggerClientWorkspaceSync } from "../../../lib/client-sync";
import { triggerClientStripeSync } from "../../../lib/client-stripe-sync";

export type ClientActionState = { ok: boolean; message: string };
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function formValue(form: FormData, key: string) { return String(form.get(key) || "").trim(); }
function validEmail(value: string) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 320; }
function validWebsite(value: string) {
  try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) && value.length <= 2048; }
  catch { return false; }
}
function actionError(message?: string) {
  if (/already exists|already assigned|duplicate/i.test(message || "")) return "That client app or contact is already in this workspace.";
  if (/schema cache|Could not find|does not exist/i.test(message || "")) return "Lead-aware client records require migration 035.";
  if (/Not authorized/i.test(message || "")) return "Your workspace access changed. Refresh and try again.";
  return "The client could not be saved. Review the fields and try again.";
}

export async function createClientAppAction(_previous: ClientActionState, form: FormData): Promise<ClientActionState> {
  const { membership } = await requireMembership();
  if (!membership) return { ok: false, message: "An active workspace membership is required." };
  const name = formValue(form, "name"); const website = formValue(form, "website_url");
  const contactName = formValue(form, "contact_name"); const email = formValue(form, "email").toLowerCase();
  const slackName = formValue(form, "slack_name"); const segment = formValue(form, "client_segment");
  if (name.length < 1 || name.length > 160 || contactName.length < 1 || contactName.length > 160 || !validWebsite(website) || !validEmail(email) || slackName.length > 120 || !["lead","epsiflow_direct","stripe_plan"].includes(segment)) return { ok: false, message: "Enter a valid app, website, relationship type, contact name, and email." };
  const supabase = await createSupabaseServerClient(); if (!supabase) return { ok: false, message: "The Clients workspace is unavailable." };
  const { data, error } = await supabase.rpc("dashboard_create_client_app", {
    target_organization_id: membership.organization.id, target_name: name, target_website_url: website,
    target_contact_name: contactName, target_contact_email: email, target_slack_name: slackName || null, target_client_segment: segment,
  });
  if (error || !data) return { ok: false, message: actionError(error?.message) };
  await triggerClientWorkspaceSync(supabase, String(data), "historical");
  revalidatePath("/dashboard/clients");
  redirect(`/dashboard/clients/${data}`);
}

export async function addClientContactAction(_previous: ClientActionState, form: FormData): Promise<ClientActionState> {
  const { membership } = await requireMembership(); if (!membership) return { ok: false, message: "An active workspace membership is required." };
  const appId = formValue(form, "client_app_id"); const name = formValue(form, "name");
  const email = formValue(form, "email").toLowerCase(); const slackName = formValue(form, "slack_name");
  if (!uuidPattern.test(appId) || name.length < 1 || name.length > 160 || !validEmail(email) || slackName.length > 120) return { ok: false, message: "Enter a valid contact name and email." };
  const supabase = await createSupabaseServerClient(); if (!supabase) return { ok: false, message: "The contact could not be saved." };
  const { error } = await supabase.rpc("dashboard_add_client_contact", {
    target_organization_id: membership.organization.id, target_client_app_id: appId,
    target_name: name, target_email: email, target_slack_name: slackName || null,
  });
  if (error) return { ok: false, message: actionError(error.message) };
  const sync = await triggerClientWorkspaceSync(supabase, appId, "historical");
  revalidatePath(`/dashboard/clients/${appId}`); revalidatePath("/dashboard/clients");
  return { ok: true, message: sync.completed ? "Contact added and correspondence synchronized." : "Contact added. Email matching will run on the next engine cycle." };
}

export async function requestClientSlackAction(_previous: ClientActionState, form: FormData): Promise<ClientActionState> {
  const { membership } = await requireMembership(); if (!membership) return { ok: false, message: "An active workspace membership is required." };
  const contactId = formValue(form, "contact_id"); const appId = formValue(form, "client_app_id"); const slackName = formValue(form, "slack_name");
  if (!uuidPattern.test(contactId) || !uuidPattern.test(appId) || slackName.length < 1 || slackName.length > 120) return { ok: false, message: "Enter the contact’s Slack display name or @handle." };
  const supabase = await createSupabaseServerClient(); if (!supabase) return { ok: false, message: "Slack assignment is unavailable." };
  const { error } = await supabase.rpc("dashboard_request_client_slack_assignment", { target_contact_id: contactId, target_slack_name: slackName });
  if (error) return { ok: false, message: actionError(error.message) };
  const sync = await triggerClientWorkspaceSync(supabase, appId);
  revalidatePath(`/dashboard/clients/${appId}`);
  return { ok: true, message: sync.completed ? "Slack chat assignment processed." : "Slack chat assignment queued for the next engine cycle." };
}

export async function setClientSlackChatLinkAction(_previous: ClientActionState, form: FormData): Promise<ClientActionState> {
  const { membership } = await requireMembership(); if (!membership) return { ok: false, message: "An active workspace membership is required." };
  const contactId = formValue(form, "contact_id"); const appId = formValue(form, "client_app_id");
  const chatUrl = formValue(form, "slack_chat_url"); const chatLabel = formValue(form, "slack_chat_label");
  let parsed: URL;
  try { parsed = new URL(chatUrl); } catch { return { ok: false, message: "Paste a valid Slack conversation link." }; }
  if (!uuidPattern.test(contactId) || !uuidPattern.test(appId) || parsed.protocol !== "https:" || !(parsed.hostname === "slack.com" || parsed.hostname.endsWith(".slack.com")) || chatUrl.length > 2048 || chatLabel.length > 120) return { ok: false, message: "Paste a valid Slack conversation link." };
  const supabase = await createSupabaseServerClient(); if (!supabase) return { ok: false, message: "Slack linking is unavailable." };
  const { error } = await supabase.rpc("dashboard_set_client_slack_chat_link", { target_contact_id: contactId, target_chat_url: chatUrl, target_chat_label: chatLabel || null });
  if (error) return { ok: false, message: /schema cache|Could not find|does not exist/i.test(error.message) ? "Slack Connect links require migration 027." : actionError(error.message) };
  revalidatePath(`/dashboard/clients/${appId}`); revalidatePath("/dashboard/audit");
  return { ok: true, message: "Slack Connect conversation linked." };
}

export async function linkClientStripeCustomerAction(_previous: ClientActionState, form: FormData): Promise<ClientActionState> {
  const { membership } = await requireMembership();
  if (!membership) return { ok: false, message: "An active workspace membership is required." };
  const appId = formValue(form, "client_app_id");
  const customerId = formValue(form, "stripe_customer_id");
  if (!uuidPattern.test(appId) || !/^cus_[A-Za-z0-9]+$/.test(customerId) || customerId.length > 255) return { ok: false, message: "Enter a valid Stripe customer ID beginning with cus_." };
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { ok: false, message: "Stripe linking is unavailable." };
  const { error } = await supabase.rpc("dashboard_link_client_stripe_customer", { target_client_app_id: appId, target_stripe_customer_id: customerId });
  if (error) {
    if (/schema cache|Could not find|does not exist/i.test(error.message)) return { ok: false, message: "Stripe subscription visibility requires migration 028." };
    if (/already linked/i.test(error.message)) return { ok: false, message: "That Stripe customer is already linked to another client." };
    return { ok: false, message: "The Stripe customer could not be linked." };
  }
  const sync = await triggerClientStripeSync(supabase, appId);
  revalidatePath(`/dashboard/clients/${appId}`); revalidatePath("/dashboard/audit");
  return { ok: true, message: sync.completed ? "Stripe customer linked and subscriptions synchronized." : "Stripe customer linked. Subscription synchronization is queued for the engine." };
}

export async function createClientPlaybookDraftAction(_previous: ClientActionState, form: FormData): Promise<ClientActionState> {
  const { membership } = await requireMembership();
  if (!membership) return { ok: false, message: "An active workspace membership is required." };
  const appId = formValue(form, "client_app_id"); const contactId = formValue(form, "contact_id"); const playbookId = formValue(form, "playbook_id");
  if (![appId, contactId, playbookId].every(value => uuidPattern.test(value))) return { ok: false, message: "Choose a valid playbook and client contact." };
  const supabase = await createSupabaseServerClient(); if (!supabase) return { ok: false, message: "Client playbooks are unavailable." };
  const { error } = await supabase.rpc("dashboard_create_client_playbook_draft", { target_playbook_id: playbookId, target_client_app_id: appId, target_client_contact_id: contactId });
  if (error) {
    if (/schema cache|Could not find|does not exist/i.test(error.message)) return { ok: false, message: "Client playbooks require migration 030." };
    if (/not eligible/i.test(error.message)) return { ok: false, message: "This client’s current subscription state does not match the playbook conditions." };
    if (/no linked Slack/i.test(error.message)) return { ok: false, message: "Link a Slack conversation for this contact before preparing a Slack draft." };
    if (/open draft already exists/i.test(error.message)) return { ok: false, message: "An open draft already exists for this playbook and contact." };
    return { ok: false, message: "The client draft could not be prepared." };
  }
  revalidatePath(`/dashboard/clients/${appId}`); revalidatePath("/dashboard/approvals"); revalidatePath("/dashboard/audit");
  return { ok: true, message: "Draft prepared. Review it in Approvals; nothing has been sent." };
}

export async function setClientRelationshipAction(_previous: ClientActionState, form: FormData): Promise<ClientActionState> {
  const { membership } = await requireMembership(); if (!membership) return { ok: false, message: "An active workspace membership is required." };
  const appId=formValue(form,"client_app_id"), segment=formValue(form,"client_segment"), relationshipState=formValue(form,"relationship_state"), note=formValue(form,"relationship_note");
  const enabled=form.get("client_success_enabled")==="on";
  if (!uuidPattern.test(appId) || !["lead","epsiflow_direct","stripe_plan"].includes(segment) || !["active","churned","closed"].includes(relationshipState) || note.length>1000) return { ok:false,message:"Choose a valid relationship type and state." };
  const supabase=await createSupabaseServerClient(); if(!supabase) return {ok:false,message:"Relationship controls are unavailable."};
  const {error}=await supabase.rpc("dashboard_set_client_relationship",{target_client_app_id:appId,target_client_segment:segment,target_relationship_state:relationshipState,target_client_success_enabled:enabled,target_relationship_note:note});
  if(error) return {ok:false,message:/schema cache|Could not find|does not exist/i.test(error.message)?"Lead-aware relationship controls require migration 035.":"The relationship could not be updated."};
  const {data: saved,error: verifyError}=await supabase.from("client_apps").select("client_segment,relationship_state,client_success_enabled").eq("id",appId).maybeSingle();
  if(verifyError || !saved || saved.client_segment!==segment || saved.relationship_state!==relationshipState) return {ok:false,message:"The relationship save could not be confirmed. Refresh and try again."};
  revalidatePath(`/dashboard/clients/${appId}`); revalidatePath("/dashboard/clients"); revalidatePath("/dashboard/audit");
  const segmentLabel=segment==="lead"?"Lead":segment==="epsiflow_direct"?"EpsiFlow Direct":"Stripe plan";
  return {ok:true,message:relationshipState==="closed"?"Relationship closed. Client-success automation is off.":`${segmentLabel} relationship saved as ${relationshipState}.`};
}
