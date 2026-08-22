import type { SupabaseClient } from "@supabase/supabase-js";

export type ClientContact = {
  id: string;
  name: string;
  email: string;
  slackName: string | null;
  slackDisplayName: string | null;
  slackStatus: "unassigned" | "pending" | "assigned" | "failed";
  slackTeamId: string | null;
  slackChannelId: string | null;
  slackFailureCode: string | null;
  lastEmailSyncAt: string | null;
};

export type ClientAppSummary = {
  id: string;
  name: string;
  websiteUrl: string;
  status: string;
  updatedAt: string;
  contacts: ClientContact[];
};

export type ClientMessage = {
  id: string;
  clientContactId: string;
  threadKey: string;
  direction: "inbound" | "outbound";
  subject: string | null;
  body: string | null;
  occurredAt: string;
};

type ContactRecord = {
  id: string; name: string; email: string; slack_name: string | null;
  slack_display_name: string | null; slack_assignment_status: ClientContact["slackStatus"];
  slack_team_id: string | null; slack_channel_id: string | null;
  slack_failure_code: string | null; last_email_sync_at: string | null;
};

function contact(record: ContactRecord): ClientContact {
  return {
    id: record.id, name: record.name, email: record.email, slackName: record.slack_name,
    slackDisplayName: record.slack_display_name, slackStatus: record.slack_assignment_status,
    slackTeamId: record.slack_team_id, slackChannelId: record.slack_channel_id,
    slackFailureCode: record.slack_failure_code, lastEmailSyncAt: record.last_email_sync_at,
  };
}

export async function getClientApps(supabase: SupabaseClient, organizationId: string) {
  const { data, error } = await supabase.from("client_apps")
    .select("id,name,website_url,status,updated_at,contacts:client_contacts(id,name,email,slack_name,slack_display_name,slack_assignment_status,slack_team_id,slack_channel_id,slack_failure_code,last_email_sync_at)")
    .eq("organization_id", organizationId).order("updated_at", { ascending: false });
  if (error) return { ready: false, apps: [] as ClientAppSummary[] };
  const apps = (data ?? []).map(row => ({
    id: row.id, name: row.name, websiteUrl: row.website_url, status: row.status,
    updatedAt: row.updated_at, contacts: ((row.contacts ?? []) as ContactRecord[]).map(contact),
  }));
  return { ready: true, apps };
}

export async function getClientAppDetail(supabase: SupabaseClient, organizationId: string, clientAppId: string) {
  const [appResult, messagesResult] = await Promise.all([
    supabase.from("client_apps")
      .select("id,name,website_url,status,updated_at,contacts:client_contacts(id,name,email,slack_name,slack_display_name,slack_assignment_status,slack_team_id,slack_channel_id,slack_failure_code,last_email_sync_at)")
      .eq("organization_id", organizationId).eq("id", clientAppId).maybeSingle(),
    supabase.from("client_email_messages")
      .select("id,client_contact_id,thread_key,direction,subject,body,occurred_at")
      .eq("organization_id", organizationId).eq("client_app_id", clientAppId)
      .order("occurred_at", { ascending: false }).limit(250),
  ]);
  if (appResult.error || !appResult.data) return { ready: !appResult.error, app: null, messages: [] as ClientMessage[] };
  const row = appResult.data;
  const app: ClientAppSummary = {
    id: row.id, name: row.name, websiteUrl: row.website_url, status: row.status,
    updatedAt: row.updated_at, contacts: ((row.contacts ?? []) as ContactRecord[]).map(contact),
  };
  const messages = (messagesResult.data ?? []).map(message => ({
    id: message.id, clientContactId: message.client_contact_id,
    threadKey: message.thread_key || message.id,
    direction: message.direction as ClientMessage["direction"], subject: message.subject,
    body: message.body, occurredAt: message.occurred_at,
  }));
  return { ready: !messagesResult.error, app, messages };
}
