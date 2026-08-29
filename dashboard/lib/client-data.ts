import type { SupabaseClient } from "@supabase/supabase-js";

export type ClientContact = {
  id: string;
  name: string;
  email: string;
  slackName: string | null;
  slackDisplayName: string | null;
  slackStatus: "unassigned" | "pending" | "assigned" | "failed" | "linked";
  slackTeamId: string | null;
  slackChannelId: string | null;
  slackChatUrl: string | null;
  slackChatLabel: string | null;
  slackFailureCode: string | null;
  lastEmailSyncAt: string | null;
};

export type ClientPlan = {
  label: string;
  status: string;
  price: string | null;
};

export type ClientAppSummary = {
  id: string;
  name: string;
  websiteUrl: string;
  status: string;
  clientSegment: "lead" | "epsiflow_direct" | "stripe_plan";
  relationshipState: "active" | "churned" | "closed";
  clientSuccessEnabled: boolean;
  relationshipNote: string;
  updatedAt: string;
  contacts: ClientContact[];
  plan: ClientPlan | null;
};

type SubscriptionSummaryRecord = {
  status: string; product_name: string | null; price_nickname: string | null;
  billing_interval: string | null; interval_count?: number | null;
  unit_amount: number | null; currency: string | null;
};

const subscriptionRank: Record<string, number> = { active: 1, trialing: 2, past_due: 3, unpaid: 4 };

function planPrice(record: SubscriptionSummaryRecord): string | null {
  if (record.unit_amount === null || !record.currency) return null;
  let amount: string;
  try { amount = new Intl.NumberFormat("en", { style: "currency", currency: record.currency.toUpperCase() }).format(record.unit_amount / 100); }
  catch { amount = `${record.unit_amount / 100} ${record.currency.toUpperCase()}`; }
  if (!record.billing_interval) return amount;
  const count = record.interval_count && record.interval_count > 1 ? `${record.interval_count} ` : "";
  return `${amount} / ${count}${record.billing_interval}`;
}

function primaryPlan(records: SubscriptionSummaryRecord[]): ClientPlan | null {
  if (!records.length) return null;
  const best = [...records].sort((a, b) => (subscriptionRank[a.status] ?? 5) - (subscriptionRank[b.status] ?? 5))[0];
  return { label: best.product_name || best.price_nickname || "Subscription", status: best.status, price: planPrice(best) };
}

export type ClientSubscription = {
  id: string; stripeSubscriptionId: string; status: string; productName: string | null;
  priceNickname: string | null; quantity: number | null; unitAmount: number | null;
  currency: string | null; billingInterval: string | null; intervalCount: number | null;
  currentPeriodStart: string | null; currentPeriodEnd: string | null; trialEnd: string | null;
  cancelAt: string | null; cancelAtPeriodEnd: boolean; canceledAt: string | null;
  latestInvoiceStatus: string | null; syncedAt: string;
};

export type ClientStripeState = {
  ready: boolean; customerId: string | null; customerEmail: string | null; customerName: string | null;
  syncStatus: "unlinked" | "pending" | "synced" | "failed"; failureCode: string | null;
  lastSyncAt: string | null; subscriptions: ClientSubscription[];
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
  slack_chat_url: string | null; slack_chat_label: string | null;
  slack_failure_code: string | null; last_email_sync_at: string | null;
};

function contact(record: ContactRecord): ClientContact {
  return {
    id: record.id, name: record.name, email: record.email, slackName: record.slack_name,
    slackDisplayName: record.slack_display_name, slackStatus: record.slack_assignment_status,
    slackTeamId: record.slack_team_id, slackChannelId: record.slack_channel_id,
    slackChatUrl: record.slack_chat_url, slackChatLabel: record.slack_chat_label,
    slackFailureCode: record.slack_failure_code, lastEmailSyncAt: record.last_email_sync_at,
  };
}

export async function getClientApps(supabase: SupabaseClient, organizationId: string) {
  const { data, error } = await supabase.from("client_apps")
    .select("id,name,website_url,status,client_segment,relationship_state,client_success_enabled,relationship_note,updated_at,contacts:client_contacts(id,name,email,slack_name,slack_display_name,slack_assignment_status,slack_team_id,slack_channel_id,slack_chat_url,slack_chat_label,slack_failure_code,last_email_sync_at),subscriptions:client_subscriptions(status,product_name,price_nickname,billing_interval,interval_count,unit_amount,currency)")
    .eq("organization_id", organizationId).order("updated_at", { ascending: false });
  if (error) return { ready: false, apps: [] as ClientAppSummary[] };
  const apps = (data ?? []).map(row => ({
    id: row.id, name: row.name, websiteUrl: row.website_url, status: row.status, clientSegment: row.client_segment, relationshipState: row.relationship_state, clientSuccessEnabled: row.client_success_enabled, relationshipNote: row.relationship_note,
    updatedAt: row.updated_at, contacts: ((row.contacts ?? []) as ContactRecord[]).map(contact),
    plan: primaryPlan((row.subscriptions ?? []) as SubscriptionSummaryRecord[]),
  }));
  return { ready: true, apps };
}

export async function getClientAppDetail(supabase: SupabaseClient, organizationId: string, clientAppId: string) {
  const [appResult, messagesResult, stripeAppResult, subscriptionsResult] = await Promise.all([
    supabase.from("client_apps")
      .select("id,name,website_url,status,client_segment,relationship_state,client_success_enabled,relationship_note,updated_at,contacts:client_contacts(id,name,email,slack_name,slack_display_name,slack_assignment_status,slack_team_id,slack_channel_id,slack_chat_url,slack_chat_label,slack_failure_code,last_email_sync_at)")
      .eq("organization_id", organizationId).eq("id", clientAppId).maybeSingle(),
    supabase.from("client_email_messages")
      .select("id,client_contact_id,thread_key,direction,subject,body,occurred_at")
      .eq("organization_id", organizationId).eq("client_app_id", clientAppId)
      .order("occurred_at", { ascending: false }).limit(250),
    supabase.from("client_apps")
      .select("stripe_customer_id,stripe_customer_email,stripe_customer_name,stripe_sync_status,stripe_sync_failure_code,last_stripe_sync_at")
      .eq("organization_id", organizationId).eq("id", clientAppId).maybeSingle(),
    supabase.from("client_subscriptions")
      .select("id,stripe_subscription_id,status,product_name,price_nickname,quantity,unit_amount,currency,billing_interval,interval_count,current_period_start,current_period_end,trial_end,cancel_at,cancel_at_period_end,canceled_at,latest_invoice_status,synced_at")
      .eq("organization_id", organizationId).eq("client_app_id", clientAppId)
      .order("current_period_end", { ascending: false, nullsFirst: false }),
  ]);
  if (appResult.error || !appResult.data) return { ready: !appResult.error, app: null, messages: [] as ClientMessage[] };
  const row = appResult.data;
  const app: ClientAppSummary = {
    id: row.id, name: row.name, websiteUrl: row.website_url, status: row.status, clientSegment: row.client_segment, relationshipState: row.relationship_state, clientSuccessEnabled: row.client_success_enabled, relationshipNote: row.relationship_note,
    updatedAt: row.updated_at, contacts: ((row.contacts ?? []) as ContactRecord[]).map(contact),
    plan: primaryPlan((subscriptionsResult.data ?? []) as SubscriptionSummaryRecord[]),
  };
  const messages = (messagesResult.data ?? []).map(message => ({
    id: message.id, clientContactId: message.client_contact_id,
    threadKey: message.thread_key || message.id,
    direction: message.direction as ClientMessage["direction"], subject: message.subject,
    body: message.body, occurredAt: message.occurred_at,
  }));
  const stripeRow = stripeAppResult.data;
  const stripe: ClientStripeState = {
    ready: !stripeAppResult.error && !subscriptionsResult.error,
    customerId: stripeRow?.stripe_customer_id ?? null, customerEmail: stripeRow?.stripe_customer_email ?? null,
    customerName: stripeRow?.stripe_customer_name ?? null,
    syncStatus: stripeRow?.stripe_sync_status ?? "unlinked", failureCode: stripeRow?.stripe_sync_failure_code ?? null,
    lastSyncAt: stripeRow?.last_stripe_sync_at ?? null,
    subscriptions: (subscriptionsResult.data ?? []).map(row => ({
      id: row.id, stripeSubscriptionId: row.stripe_subscription_id, status: row.status,
      productName: row.product_name, priceNickname: row.price_nickname, quantity: row.quantity,
      unitAmount: row.unit_amount, currency: row.currency, billingInterval: row.billing_interval,
      intervalCount: row.interval_count, currentPeriodStart: row.current_period_start,
      currentPeriodEnd: row.current_period_end, trialEnd: row.trial_end, cancelAt: row.cancel_at,
      cancelAtPeriodEnd: row.cancel_at_period_end, canceledAt: row.canceled_at,
      latestInvoiceStatus: row.latest_invoice_status, syncedAt: row.synced_at,
    })),
  };
  return { ready: !messagesResult.error, app, messages, stripe };
}
