"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireMembership } from "../../../lib/auth";
import { createSupabaseServerClient } from "../../../lib/supabase-server";
import { triggerClientWorkspaceSync } from "../../../lib/client-sync";

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
  if (/schema cache|Could not find|does not exist/i.test(message || "")) return "The Clients workspace requires migration 025.";
  if (/Not authorized/i.test(message || "")) return "Your workspace access changed. Refresh and try again.";
  return "The client could not be saved. Review the fields and try again.";
}

export async function createClientAppAction(_previous: ClientActionState, form: FormData): Promise<ClientActionState> {
  const { membership } = await requireMembership();
  if (!membership) return { ok: false, message: "An active workspace membership is required." };
  const name = formValue(form, "name"); const website = formValue(form, "website_url");
  const contactName = formValue(form, "contact_name"); const email = formValue(form, "email").toLowerCase();
  const slackName = formValue(form, "slack_name");
  if (name.length < 1 || name.length > 160 || contactName.length < 1 || contactName.length > 160 || !validWebsite(website) || !validEmail(email) || slackName.length > 120) return { ok: false, message: "Enter a valid app, website, contact name, and email." };
  const supabase = await createSupabaseServerClient(); if (!supabase) return { ok: false, message: "The Clients workspace is unavailable." };
  const { data, error } = await supabase.rpc("dashboard_create_client_app", {
    target_organization_id: membership.organization.id, target_name: name, target_website_url: website,
    target_contact_name: contactName, target_contact_email: email, target_slack_name: slackName || null,
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
