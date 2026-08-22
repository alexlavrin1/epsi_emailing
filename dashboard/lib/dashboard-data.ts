import type { SupabaseClient } from "@supabase/supabase-js";

type Related<T> = T | T[] | null;

type ProspectIdentity = {
  first_name: string | null;
  last_name: string | null;
  email: string;
  company: string | null;
};

type CustomerIdentity = { name: string | null; email: string | null };

export type AttentionItem = {
  id: string;
  tone: "danger" | "warning" | "neutral";
  title: string;
  detail: string;
  href: string;
};

export type ActivityItem = {
  id: string;
  type: "reply" | "payment" | "outreach";
  title: string;
  detail: string;
  occurredAt: string;
  href: string;
};

export type OverviewData = {
  metrics: {
    contacts: number;
    activeCampaigns: number;
    replies: number;
    openRecoveries: number;
    scheduledSends: number;
  };
  attention: AttentionItem[];
  activity: ActivityItem[];
  slack: SlackHealth;
};

export type LifecycleStage = "prospect" | "interested" | "client" | "at_risk" | "suppressed";

export type PipelineContact = {
  key: string;
  id: string;
  kind: "prospect" | "customer";
  name: string;
  email: string;
  company: string;
  stage: LifecycleStage;
  channels: string;
  lastActivity: string;
};

export type PipelineStage = {
  id: LifecycleStage;
  label: string;
  description: string;
  contacts: PipelineContact[];
};

export type SlackActivity = {
  id: string;
  customerId: string | null;
  customer: string;
  status: string;
  step: number;
  occurredAt: string;
  error: string | null;
};

export type SlackHealth = {
  mappedClients: number;
  enabledClients: number;
  queued: number;
  sent: number;
  failed: number;
  recent: SlackActivity[];
};

export type ContactRow = {
  id: string;
  kind: "prospect" | "customer";
  name: string;
  email: string;
  company: string;
  status: string;
  channel: string;
  lastActivity: string;
};

export type CompanyRow = { name: string; contacts: number; active: number; replied: number; lastActivity: string };

export type CampaignRow = {
  id: string;
  name: string;
  status: string;
  mailbox: string;
  steps: number;
  scheduled: number;
  sent: number;
  replied: number;
  updatedAt: string;
};

export type ReplyRow = {
  id: string;
  prospectId: string | null;
  sender: string;
  email: string;
  company: string;
  subject: string;
  preview: string;
  receivedAt: string;
};

export type ApprovalData = {
  ready: boolean;
  replies: Array<{ id: string; status: string; body: string; lastError: string | null; createdAt: string; contact: string; email: string; subject: string; automationName: string | null }>;
  retries: Array<{ id: string; channel: string; attempts: number; error: string; updatedAt: string; customer: string }>;
};

export type AutomationWorkflow = {
  id: string;
  name: string;
  description: string;
  status: "draft" | "active" | "paused";
  triggerType: string;
  approvalMode: "required";
  delayMinutes: number;
  currentVersion: number;
  currentTemplate: string;
  versions: number;
  updatedAt: string;
};

export type AutomationRun = {
  id: string;
  workflowName: string;
  workflowVersion: number;
  status: string;
  contact: string;
  prospectId: string;
  scheduledFor: string;
  createdAt: string;
  completedAt: string | null;
  lastError: string | null;
  replyStatus: string | null;
};

export type AutomationFailureAlert = {
  id: string;
  sourceType: "automation_run" | "worker_cycle";
  sourceId: string;
  severity: "warning" | "critical";
  failureCode: string;
  workflowName: string | null;
  createdAt: string;
};

export type AutomationData = {
  ready: boolean;
  workflows: AutomationWorkflow[];
  runs: AutomationRun[];
  metrics: { active: number; waitingApproval: number; succeeded: number; failed: number };
  runtime: { ready: boolean; paused: boolean; reason: string | null; pausedAt: string | null; updatedAt: string | null };
  limits: { ready: boolean; hourlyLimit: number; usedThisHour: number; rateLimited24h: number };
  alerts: { ready: boolean; openCount: number; items: AutomationFailureAlert[] };
  performance: { ready: boolean; days: 7 | 30; totalRuns: number; preparedDrafts: number; approvedDrafts: number; deliveredReplies: number; declinedDrafts: number; failedRuns: number; activeRuns: number; averageSuccessSeconds: number };
  worker: { ready: boolean; state: "unknown" | "running" | "healthy" | "failed" | "stale"; latestStartedAt: string | null; lastSuccessAt: string | null; recentFailures: number; latestFailureCode: string | null };
};

export type AuditEvent = {
  id: string;
  actorUserId: string | null;
  eventType: string;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type AuditData = {
  events: AuditEvent[];
  total: number;
  limited: boolean;
};

export type ContactDetail = {
  id: string;
  kind: "prospect" | "customer";
  name: string;
  email: string;
  company: string;
  title: string;
  status: string;
  facts: Array<{ label: string; value: string }>;
  timeline: Array<{ id: string; type: string; title: string; detail: string; occurredAt: string }>;
};

export type ContactActionData = {
  ready: boolean;
  lifecycleStage: LifecycleStage | null;
  notes: Array<{ id: string; body: string; createdAt: string }>;
  tasks: Array<{ id: string; title: string; status: "open" | "completed"; dueAt: string | null; completedAt: string | null; createdAt: string }>;
};

function one<T>(value: Related<T>): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function displayProspect(prospect: ProspectIdentity | null) {
  if (!prospect) return "Unknown prospect";
  return [prospect.first_name, prospect.last_name].filter(Boolean).join(" ") || prospect.email;
}

function displayCustomer(customer: CustomerIdentity | null) {
  return customer?.name || customer?.email || "Unknown client";
}

function latestDate(values: Array<string | null | undefined>) {
  return values.filter(Boolean).sort().at(-1) ?? new Date(0).toISOString();
}

function logQueryError(label: string, error: { message: string } | null) {
  if (error) console.error(`Dashboard query failed: ${label}`, { message: error.message });
}

export function formatMoney(amount: number, currency: string) {
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency: currency.toUpperCase(),
    maximumFractionDigits: 2,
  }).format(amount / 100);
}

export function formatWhen(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.getTime() === 0) return "No activity yet";
  const diff = Date.now() - date.getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric" }).format(date);
}

export async function getOverviewData(supabase: SupabaseClient, organizationId: string): Promise<OverviewData> {
  const now = new Date().toISOString();
  const [prospects, customers, campaigns, replies, recoveries, scheduled, failedMessages, overdueCases, recentReplies, recentRecoveries, recentSends, slack] = await Promise.all([
    supabase.from("prospects").select("id", { count: "exact", head: true }).eq("organization_id", organizationId),
    supabase.from("crm_customers").select("id", { count: "exact", head: true }).eq("organization_id", organizationId),
    supabase.from("campaigns").select("id", { count: "exact", head: true }).eq("organization_id", organizationId).eq("status", "active"),
    supabase.from("prospect_replies").select("id", { count: "exact", head: true }),
    supabase.from("payment_recovery_cases").select("id", { count: "exact", head: true }).eq("state", "open"),
    supabase.from("outreach_sends").select("id", { count: "exact", head: true }).eq("status", "scheduled"),
    supabase.from("payment_recovery_messages").select("id,recovery_case_id,channel,last_error,updated_at,recovery_case:payment_recovery_cases(id,crm_customer_id,customer:crm_customers(name,email))").eq("status", "failed").order("updated_at", { ascending: false }).limit(4),
    supabase.from("payment_recovery_cases").select("id,amount_remaining,currency,next_reminder_at,customer:crm_customers(name,email)").eq("state", "open").lt("next_reminder_at", now).order("next_reminder_at", { ascending: true }).limit(4),
    supabase.from("prospect_replies").select("id,subject,received_at,created_at,prospect_id,prospect:prospects(first_name,last_name,email,company)").order("received_at", { ascending: false }).limit(5),
    supabase.from("payment_recovery_cases").select("id,state,amount_remaining,currency,opened_at,updated_at,crm_customer_id,customer:crm_customers(name,email)").order("updated_at", { ascending: false }).limit(5),
    supabase.from("outreach_sends").select("id,status,sent_at,replied_at,updated_at,prospect_id,prospect:prospects(first_name,last_name,email,company)").in("status", ["sent", "replied", "bounced"]).order("updated_at", { ascending: false }).limit(5),
    getSlackHealth(supabase, organizationId),
  ]);

  [prospects, customers, campaigns, replies, recoveries, scheduled].forEach((result, index) => logQueryError(["prospects", "customers", "campaigns", "replies", "recoveries", "scheduled sends"][index], result.error));
  logQueryError("failed recovery messages", failedMessages.error);
  logQueryError("overdue recovery cases", overdueCases.error);
  logQueryError("recent replies", recentReplies.error);
  logQueryError("recent recoveries", recentRecoveries.error);
  logQueryError("recent outreach", recentSends.error);

  const attention: AttentionItem[] = [];
  for (const message of failedMessages.data ?? []) {
    const recovery = one(message.recovery_case as Related<{ id: string; crm_customer_id: string; customer: Related<CustomerIdentity> }>);
    const customer = one(recovery?.customer ?? null);
    attention.push({
      id: `message-${message.id}`,
      tone: "danger",
      title: `${message.channel === "slack" ? "Slack" : "Email"} delivery failed`,
      detail: `${displayCustomer(customer)} · ${message.last_error || "Provider error requires review"}`,
      href: "/dashboard/approvals#recovery-retries",
    });
  }
  for (const recovery of overdueCases.data ?? []) {
    const customer = one(recovery.customer as Related<CustomerIdentity>);
    attention.push({
      id: `recovery-${recovery.id}`,
      tone: "warning",
      title: "Payment recovery is overdue",
      detail: `${displayCustomer(customer)} · ${formatMoney(Number(recovery.amount_remaining), recovery.currency)}`,
      href: "/dashboard/crm",
    });
  }

  const activity: ActivityItem[] = [
    ...(recentReplies.data ?? []).map(reply => {
      const prospect = one(reply.prospect as Related<ProspectIdentity>);
      return {
        id: `reply-${reply.id}`,
        type: "reply" as const,
        title: `${displayProspect(prospect)} replied`,
        detail: reply.subject || "Email reply received",
        occurredAt: reply.received_at || reply.created_at,
        href: reply.prospect_id ? `/dashboard/crm/prospect/${reply.prospect_id}` : "/dashboard/crm",
      };
    }),
    ...(recentRecoveries.data ?? []).map(recovery => {
      const customer = one(recovery.customer as Related<CustomerIdentity>);
      return {
        id: `payment-${recovery.id}`,
        type: "payment" as const,
        title: `${displayCustomer(customer)} · recovery ${recovery.state}`,
        detail: formatMoney(Number(recovery.amount_remaining), recovery.currency),
        occurredAt: recovery.updated_at || recovery.opened_at,
        href: recovery.crm_customer_id ? `/dashboard/crm/customer/${recovery.crm_customer_id}` : "/dashboard/crm",
      };
    }),
    ...(recentSends.data ?? []).map(send => {
      const prospect = one(send.prospect as Related<ProspectIdentity>);
      return {
        id: `outreach-${send.id}`,
        type: "outreach" as const,
        title: `${displayProspect(prospect)} · outreach ${send.status}`,
        detail: prospect?.company || prospect?.email || "Outreach activity",
        occurredAt: send.replied_at || send.sent_at || send.updated_at,
        href: send.prospect_id ? `/dashboard/crm/prospect/${send.prospect_id}` : "/dashboard/crm",
      };
    }),
  ].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)).slice(0, 8);

  return {
    metrics: {
      contacts: (prospects.count ?? 0) + (customers.count ?? 0),
      activeCampaigns: campaigns.count ?? 0,
      replies: replies.count ?? 0,
      openRecoveries: recoveries.count ?? 0,
      scheduledSends: scheduled.count ?? 0,
    },
    attention,
    activity,
    slack,
  };
}

export async function getSlackHealth(supabase: SupabaseClient, organizationId: string): Promise<SlackHealth> {
  const [clients, messages] = await Promise.all([
    supabase.from("crm_customers").select("id,slack_enabled,slack_team_id,slack_user_id").eq("organization_id", organizationId),
    supabase.from("payment_recovery_messages").select("id,status,step_number,sent_at,scheduled_for,updated_at,last_error,recovery_case:payment_recovery_cases(crm_customer_id,customer:crm_customers(name,email))").eq("channel", "slack").order("updated_at", { ascending: false }).limit(100),
  ]);
  logQueryError("Slack client mappings", clients.error);
  logQueryError("Slack recovery activity", messages.error);

  const rows = messages.data ?? [];
  return {
    mappedClients: (clients.data ?? []).filter(client => client.slack_team_id && client.slack_user_id).length,
    enabledClients: (clients.data ?? []).filter(client => client.slack_enabled).length,
    queued: rows.filter(message => ["queued", "sending"].includes(message.status)).length,
    sent: rows.filter(message => message.status === "sent").length,
    failed: rows.filter(message => message.status === "failed").length,
    recent: rows.slice(0, 6).map(message => {
      const recovery = one(message.recovery_case as Related<{ crm_customer_id: string; customer: Related<CustomerIdentity> }>);
      return {
        id: message.id,
        customerId: recovery?.crm_customer_id ?? null,
        customer: displayCustomer(one(recovery?.customer ?? null)),
        status: message.status,
        step: message.step_number,
        occurredAt: message.sent_at || message.updated_at || message.scheduled_for,
        error: message.last_error,
      };
    }),
  };
}

export async function getPipeline(supabase: SupabaseClient, organizationId: string): Promise<PipelineStage[]> {
  const [prospects, customers, overrides] = await Promise.all([
    supabase.from("prospects").select("id,email,first_name,last_name,company,status,updated_at,outreach_sends(status,sent_at,replied_at,updated_at)").eq("organization_id", organizationId).limit(500),
    supabase.from("crm_customers").select("id,email,name,status,email_enabled,slack_enabled,updated_at,payment_recovery_cases(state,opened_at,resolved_at,updated_at)").eq("organization_id", organizationId).limit(500),
    supabase.from("crm_contact_overrides").select("contact_kind,contact_id,lifecycle_stage").eq("organization_id", organizationId),
  ]);
  logQueryError("pipeline prospects", prospects.error);
  logQueryError("pipeline customers", customers.error);
  if (overrides.error && !overrides.error.message.includes("crm_contact_overrides")) logQueryError("pipeline lifecycle overrides", overrides.error);

  const stageOverrides = new Map((overrides.data ?? []).map(item => [`${item.contact_kind}:${item.contact_id}`, item.lifecycle_stage as LifecycleStage]));

  const contacts = new Map<string, PipelineContact>();
  for (const prospect of prospects.data ?? []) {
    const sends = (prospect.outreach_sends ?? []) as Array<{ status: string; sent_at: string | null; replied_at: string | null; updated_at: string }>;
    const suppressed = ["unsubscribed", "bounced", "suppressed"].includes(prospect.status);
    const replied = sends.some(send => send.status === "replied");
    const key = `email:${prospect.email.trim().toLowerCase()}`;
    contacts.set(key, {
      key,
      id: prospect.id,
      kind: "prospect",
      name: [prospect.first_name, prospect.last_name].filter(Boolean).join(" ") || prospect.email,
      email: prospect.email,
      company: prospect.company || "—",
      stage: stageOverrides.get(`prospect:${prospect.id}`) ?? (suppressed ? "suppressed" : replied ? "interested" : "prospect"),
      channels: "Email outreach",
      lastActivity: latestDate([prospect.updated_at, ...sends.flatMap(send => [send.updated_at, send.sent_at, send.replied_at])]),
    });
  }

  for (const customer of customers.data ?? []) {
    const cases = (customer.payment_recovery_cases ?? []) as Array<{ state: string; opened_at: string; resolved_at: string | null; updated_at: string }>;
    const key = customer.email ? `email:${customer.email.trim().toLowerCase()}` : `customer:${customer.id}`;
    const existing = contacts.get(key);
    const stage: LifecycleStage = stageOverrides.get(`customer:${customer.id}`) ?? (customer.status === "suppressed" ? "suppressed" : cases.some(item => item.state === "open") ? "at_risk" : "client");
    contacts.set(key, {
      key,
      id: customer.id,
      kind: "customer",
      name: customer.name || existing?.name || customer.email || "Unnamed client",
      email: customer.email || existing?.email || "—",
      company: existing?.company && existing.company !== "—" ? existing.company : "Client",
      stage,
      channels: [customer.email_enabled ? "Email" : null, customer.slack_enabled ? "Slack" : null].filter(Boolean).join(" + ") || "No channel",
      lastActivity: latestDate([existing?.lastActivity, customer.updated_at, ...cases.flatMap(item => [item.updated_at, item.opened_at, item.resolved_at])]),
    });
  }

  const definitions: Array<Omit<PipelineStage, "contacts">> = [
    { id: "prospect", label: "Prospects", description: "Active outreach contacts" },
    { id: "interested", label: "Interested", description: "Prospects who replied" },
    { id: "client", label: "Clients", description: "Active paying customers" },
    { id: "at_risk", label: "At risk", description: "Clients in payment recovery" },
    { id: "suppressed", label: "Suppressed", description: "Contact is intentionally paused" },
  ];
  return definitions.map(stage => ({
    ...stage,
    contacts: [...contacts.values()].filter(contact => contact.stage === stage.id).sort((a, b) => b.lastActivity.localeCompare(a.lastActivity)),
  }));
}

export async function getContactActionData(supabase: SupabaseClient, organizationId: string, kind: string, id: string): Promise<ContactActionData> {
  if (!(["prospect", "customer"] as string[]).includes(kind)) return { ready: false, lifecycleStage: null, notes: [], tasks: [] };
  const [override, notes, tasks] = await Promise.all([
    supabase.from("crm_contact_overrides").select("lifecycle_stage").eq("organization_id", organizationId).eq("contact_kind", kind).eq("contact_id", id).maybeSingle(),
    supabase.from("crm_contact_notes").select("id,body,created_at").eq("organization_id", organizationId).eq("contact_kind", kind).eq("contact_id", id).order("created_at", { ascending: false }).limit(50),
    supabase.from("crm_contact_tasks").select("id,title,status,due_at,completed_at,created_at").eq("organization_id", organizationId).eq("contact_kind", kind).eq("contact_id", id).order("status", { ascending: false }).order("due_at", { ascending: true, nullsFirst: false }).limit(50),
  ]);
  const ready = !override.error && !notes.error && !tasks.error;
  if (ready) {
    logQueryError("contact lifecycle override", override.error);
    logQueryError("contact notes", notes.error);
    logQueryError("contact tasks", tasks.error);
  }
  return {
    ready,
    lifecycleStage: (override.data?.lifecycle_stage as LifecycleStage | undefined) ?? null,
    notes: (notes.data ?? []).map(note => ({ id: note.id, body: note.body, createdAt: note.created_at })),
    tasks: (tasks.data ?? []).map(task => ({ id: task.id, title: task.title, status: task.status, dueAt: task.due_at, completedAt: task.completed_at, createdAt: task.created_at })),
  };
}

export async function getContacts(supabase: SupabaseClient, organizationId: string, query = "", status = "all"): Promise<ContactRow[]> {
  const [prospects, customers] = await Promise.all([
    supabase.from("prospects").select("id,email,first_name,last_name,company,title,status,updated_at,outreach_sends(status,sent_at,replied_at,updated_at)").eq("organization_id", organizationId).order("updated_at", { ascending: false }).limit(250),
    supabase.from("crm_customers").select("id,email,name,status,email_enabled,slack_enabled,updated_at,payment_recovery_cases(state,opened_at,resolved_at,updated_at)").eq("organization_id", organizationId).order("updated_at", { ascending: false }).limit(250),
  ]);
  logQueryError("CRM prospects", prospects.error);
  logQueryError("CRM customers", customers.error);

  const rows: ContactRow[] = [
    ...(prospects.data ?? []).map(prospect => {
      const sends = (prospect.outreach_sends ?? []) as Array<{ status: string; sent_at: string | null; replied_at: string | null; updated_at: string }>;
      return {
        id: prospect.id,
        kind: "prospect" as const,
        name: [prospect.first_name, prospect.last_name].filter(Boolean).join(" ") || prospect.email,
        email: prospect.email,
        company: prospect.company || "—",
        status: sends.some(send => send.status === "replied") ? "replied" : prospect.status,
        channel: "Outreach",
        lastActivity: latestDate([prospect.updated_at, ...sends.flatMap(send => [send.updated_at, send.sent_at, send.replied_at])]),
      };
    }),
    ...(customers.data ?? []).map(customer => {
      const cases = (customer.payment_recovery_cases ?? []) as Array<{ state: string; opened_at: string; resolved_at: string | null; updated_at: string }>;
      return {
        id: customer.id,
        kind: "customer" as const,
        name: customer.name || customer.email || "Unnamed client",
        email: customer.email || "—",
        company: "Client",
        status: cases.some(item => item.state === "open") ? "recovery open" : customer.status,
        channel: [customer.email_enabled ? "Email" : null, customer.slack_enabled ? "Slack" : null].filter(Boolean).join(" + ") || "No channel",
        lastActivity: latestDate([customer.updated_at, ...cases.flatMap(item => [item.updated_at, item.opened_at, item.resolved_at])]),
      };
    }),
  ];

  const needle = query.trim().toLowerCase();
  return rows
    .filter(row => status === "all" || row.status === status)
    .filter(row => !needle || [row.name, row.email, row.company, row.status].some(value => value.toLowerCase().includes(needle)))
    .sort((a, b) => b.lastActivity.localeCompare(a.lastActivity));
}

export async function getCompanies(supabase: SupabaseClient, organizationId: string): Promise<CompanyRow[]> {
  const { data, error } = await supabase.from("prospects").select("company,status,updated_at,outreach_sends(status,replied_at,updated_at)").eq("organization_id", organizationId).not("company", "is", null).limit(500);
  logQueryError("companies", error);
  const companies = new Map<string, CompanyRow>();
  for (const prospect of data ?? []) {
    const name = prospect.company?.trim();
    if (!name) continue;
    const sends = (prospect.outreach_sends ?? []) as Array<{ status: string; replied_at: string | null; updated_at: string }>;
    const current = companies.get(name) ?? { name, contacts: 0, active: 0, replied: 0, lastActivity: prospect.updated_at };
    current.contacts += 1;
    if (prospect.status === "active") current.active += 1;
    if (sends.some(send => send.status === "replied")) current.replied += 1;
    current.lastActivity = latestDate([current.lastActivity, prospect.updated_at, ...sends.flatMap(send => [send.updated_at, send.replied_at])]);
    companies.set(name, current);
  }
  return [...companies.values()].sort((a, b) => b.lastActivity.localeCompare(a.lastActivity));
}

export async function getCampaigns(supabase: SupabaseClient, organizationId: string): Promise<CampaignRow[]> {
  const { data, error } = await supabase.from("campaigns")
    .select("id,name,status,updated_at,mailbox:mailboxes(email),campaign_steps(id),outreach_sends(status)")
    .eq("organization_id", organizationId).order("updated_at", { ascending: false }).limit(100);
  logQueryError("campaign controls", error);
  return (data ?? []).map(campaign => {
    const mailbox = one(campaign.mailbox as Related<{ email: string }>);
    const sends = (campaign.outreach_sends ?? []) as Array<{ status: string }>;
    return {
      id: campaign.id,
      name: campaign.name,
      status: campaign.status,
      mailbox: mailbox?.email || "No mailbox",
      steps: campaign.campaign_steps?.length ?? 0,
      scheduled: sends.filter(send => send.status === "scheduled").length,
      sent: sends.filter(send => send.status === "sent").length,
      replied: sends.filter(send => send.status === "replied").length,
      updatedAt: campaign.updated_at,
    };
  });
}

export async function getOutreachControlsReady(supabase: SupabaseClient) {
  const { data, error } = await supabase.rpc("dashboard_outreach_controls_ready");
  return !error && data === true;
}

export async function getReplies(supabase: SupabaseClient): Promise<ReplyRow[]> {
  const { data, error } = await supabase.from("prospect_replies").select("id,prospect_id,subject,body,received_at,created_at,prospect:prospects(first_name,last_name,email,company)").order("received_at", { ascending: false }).limit(100);
  logQueryError("reply inbox", error);
  return (data ?? []).map(reply => {
    const prospect = one(reply.prospect as Related<ProspectIdentity>);
    return {
      id: reply.id,
      prospectId: reply.prospect_id,
      sender: displayProspect(prospect),
      email: prospect?.email || "Unknown email",
      company: prospect?.company || "—",
      subject: reply.subject || "No subject",
      preview: String(reply.body || "Reply body unavailable").trim().slice(0, 4000),
      receivedAt: reply.received_at || reply.created_at,
    };
  });
}

export async function getApprovalData(supabase: SupabaseClient, organizationId: string): Promise<ApprovalData> {
  const automationReadiness = await supabase.rpc("dashboard_automation_controls_ready");
  const automationReady = !automationReadiness.error && automationReadiness.data === true;
  const [readiness, replies, retries] = await Promise.all([
    supabase.rpc("dashboard_reply_controls_ready"),
    supabase.from("operator_email_replies").select("id,body,status,last_error,created_at,source_reply:prospect_replies(subject,prospect:prospects(first_name,last_name,email))").eq("organization_id", organizationId).order("created_at", { ascending: false }).limit(100),
    supabase.from("payment_recovery_messages").select("id,channel,attempt_count,last_error,updated_at,recovery_case:payment_recovery_cases(customer:crm_customers(name,email,organization_id))").eq("status", "failed").order("updated_at", { ascending: false }).limit(100),
  ]);
  const ready = !readiness.error && readiness.data === true && !replies.error;
  const automationSources = automationReady
    ? await supabase.from("operator_email_replies").select("id,automation_run:automation_runs(workflow:automation_workflows(name))").eq("organization_id", organizationId).not("automation_run_id", "is", null).limit(100)
    : { data: null, error: null };
  const automationNames = new Map((automationSources.data ?? []).map(item => {
    const run = one(item.automation_run as Related<{ workflow: Related<{ name: string }> }>);
    const workflow = one(run?.workflow ?? null);
    return [item.id, workflow?.name || null] as const;
  }));
  const retryRows = (retries.data ?? []).filter(message => {
    const recovery = one(message.recovery_case as Related<{ customer: Related<CustomerIdentity & { organization_id: string }> }>);
    const customer = one(recovery?.customer ?? null);
    return customer?.organization_id === organizationId;
  });
  return {
    ready,
    replies: (replies.data ?? []).map(item => {
      const source = one(item.source_reply as Related<{ subject: string | null; prospect: Related<ProspectIdentity> }>);
      const prospect = one(source?.prospect ?? null);
      return { id: item.id, status: item.status, body: item.body, lastError: item.last_error, createdAt: item.created_at, contact: displayProspect(prospect), email: prospect?.email || "Unknown email", subject: source?.subject || "No subject", automationName: automationNames.get(item.id) || null };
    }),
    retries: retryRows.map(message => {
      const recovery = one(message.recovery_case as Related<{ customer: Related<CustomerIdentity> }>);
      return { id: message.id, channel: message.channel, attempts: message.attempt_count, error: message.last_error || "Unknown delivery error", updatedAt: message.updated_at, customer: displayCustomer(one(recovery?.customer ?? null)) };
    }),
  };
}

export async function getAutomationData(supabase: SupabaseClient, organizationId: string, performanceDays: 7 | 30 = 30): Promise<AutomationData> {
  const readiness = await supabase.rpc("dashboard_automation_controls_ready");
  if (readiness.error || readiness.data !== true) {
    return { ready: false, workflows: [], runs: [], metrics: { active: 0, waitingApproval: 0, succeeded: 0, failed: 0 }, runtime: { ready: false, paused: false, reason: null, pausedAt: null, updatedAt: null }, limits: { ready: false, hourlyLimit: 100, usedThisHour: 0, rateLimited24h: 0 }, alerts: { ready: false, openCount: 0, items: [] }, performance: { ready: false, days: performanceDays, totalRuns: 0, preparedDrafts: 0, approvedDrafts: 0, deliveredReplies: 0, declinedDrafts: 0, failedRuns: 0, activeRuns: 0, averageSuccessSeconds: 0 }, worker: { ready: false, state: "unknown", latestStartedAt: null, lastSuccessAt: null, recentFailures: 0, latestFailureCode: null } };
  }
  const [workflows, runs, runtimeReadiness, workerReadiness, limitReadiness, alertReadiness, reportingReadiness] = await Promise.all([
    supabase.from("automation_workflows")
      .select("id,name,description,status,trigger_type,approval_mode,delay_minutes,current_version,updated_at,versions:automation_workflow_versions(version,body_template,created_at)")
      .eq("organization_id", organizationId).order("updated_at", { ascending: false }).limit(100),
    supabase.from("automation_runs")
      .select("id,workflow_version,status,prospect_id,scheduled_for,created_at,completed_at,last_error,workflow:automation_workflows(name),prospect:prospects(first_name,last_name,email),replies:operator_email_replies(status)")
      .eq("organization_id", organizationId).order("created_at", { ascending: false }).limit(100),
    supabase.rpc("dashboard_automation_runtime_ready"),
    supabase.rpc("dashboard_automation_worker_health_ready"),
    supabase.rpc("dashboard_automation_rate_limits_ready"),
    supabase.rpc("dashboard_automation_failure_alerts_ready"),
    supabase.rpc("dashboard_automation_reporting_ready"),
  ]);
  const runtimeReady = !runtimeReadiness.error && runtimeReadiness.data === true;
  const workerReady = !workerReadiness.error && workerReadiness.data === true;
  const limitsReady = !limitReadiness.error && limitReadiness.data === true;
  const alertsReady = !alertReadiness.error && alertReadiness.data === true;
  const reportingReady = !reportingReadiness.error && reportingReadiness.data === true;
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const [runtime, workerCycles, rateControl, hourlyUsage, rateLimitedEvents, failureAlerts, performance] = await Promise.all([
    runtimeReady
      ? supabase.from("automation_runtime_controls").select("globally_paused,pause_reason,paused_at,updated_at").eq("organization_id", organizationId).maybeSingle()
      : Promise.resolve({ data: null, error: runtimeReadiness.error }),
    workerReady
      ? supabase.from("automation_worker_cycles").select("status,failure_code,started_at,completed_at").eq("organization_id", organizationId).order("started_at", { ascending: false }).limit(100)
      : Promise.resolve({ data: null, error: workerReadiness.error }),
    limitsReady
      ? supabase.from("automation_runtime_controls").select("hourly_run_limit").eq("organization_id", organizationId).maybeSingle()
      : Promise.resolve({ data: null, error: limitReadiness.error }),
    limitsReady
      ? supabase.from("automation_runs").select("id", { count: "exact", head: true }).eq("organization_id", organizationId).gte("created_at", hourAgo)
      : Promise.resolve({ count: null, error: limitReadiness.error }),
    limitsReady
      ? supabase.from("audit_events").select("id", { count: "exact", head: true }).eq("organization_id", organizationId).eq("event_type", "automation.run.rate_limited").gte("created_at", dayAgo)
      : Promise.resolve({ count: null, error: limitReadiness.error }),
    alertsReady
      ? supabase.from("automation_failure_alerts").select("id,source_type,source_id,severity,failure_code,created_at,workflow:automation_workflows(name)", { count: "exact" }).eq("organization_id", organizationId).is("acknowledged_at", null).order("created_at", { ascending: false }).limit(20)
      : Promise.resolve({ data: null, count: null, error: alertReadiness.error }),
    reportingReady
      ? supabase.rpc("dashboard_get_automation_performance", { target_organization_id: organizationId, target_period_days: performanceDays })
      : Promise.resolve({ data: null, error: reportingReadiness.error }),
  ]);
  logQueryError("automation workflows", workflows.error);
  logQueryError("automation runs", runs.error);
  const workflowRows: AutomationWorkflow[] = (workflows.data ?? []).map(workflow => {
    const versions = (workflow.versions ?? []) as Array<{ version: number; body_template: string; created_at: string }>;
    const current = versions.find(item => item.version === workflow.current_version);
    return {
      id: workflow.id, name: workflow.name, description: workflow.description, status: workflow.status,
      triggerType: workflow.trigger_type, approvalMode: workflow.approval_mode, delayMinutes: workflow.delay_minutes,
      currentVersion: workflow.current_version, currentTemplate: current?.body_template || "", versions: versions.length, updatedAt: workflow.updated_at,
    };
  });
  const runRows: AutomationRun[] = (runs.data ?? []).map(run => {
    const workflow = one(run.workflow as Related<{ name: string }>);
    const prospect = one(run.prospect as Related<ProspectIdentity>);
    const replies = (run.replies ?? []) as Array<{ status: string }>;
    return {
      id: run.id, workflowName: workflow?.name || "Unknown workflow", workflowVersion: run.workflow_version,
      status: run.status, contact: displayProspect(prospect), prospectId: run.prospect_id,
      scheduledFor: run.scheduled_for, createdAt: run.created_at, completedAt: run.completed_at,
      lastError: run.last_error, replyStatus: replies[0]?.status || null,
    };
  });
  const cycleRows = workerCycles.data ?? [];
  const latestCycle = cycleRows[0];
  const latestAge = latestCycle ? Date.now() - new Date(latestCycle.started_at).getTime() : Number.POSITIVE_INFINITY;
  const workerState = !latestCycle ? "unknown" : latestCycle.status === "failed" ? "failed" : latestCycle.status === "running" && latestAge <= 30 * 60 * 1000 ? "running" : latestCycle.status === "succeeded" && latestAge <= 30 * 60 * 1000 ? "healthy" : "stale";
  const lastSuccess = cycleRows.find(cycle => cycle.status === "succeeded");
  const failureCutoff = Date.now() - 24 * 60 * 60 * 1000;
  const alertRows: AutomationFailureAlert[] = (failureAlerts.data ?? []).map(alert => {
    const workflow = one(alert.workflow as Related<{ name: string }>);
    return {
      id: alert.id,
      sourceType: alert.source_type as AutomationFailureAlert["sourceType"],
      sourceId: alert.source_id,
      severity: alert.severity as AutomationFailureAlert["severity"],
      failureCode: alert.failure_code,
      workflowName: workflow?.name || null,
      createdAt: alert.created_at,
    };
  });
  const performancePayload = performance.data && typeof performance.data === "object" && !Array.isArray(performance.data) ? performance.data as Record<string, unknown> : {};
  const performanceMetric = (key: string) => Math.max(0, Number(performancePayload[key]) || 0);
  return {
    ready: !workflows.error && !runs.error,
    workflows: workflowRows,
    runs: runRows,
    metrics: {
      active: workflowRows.filter(item => item.status === "active").length,
      waitingApproval: runRows.filter(item => item.status === "waiting_approval").length,
      succeeded: runRows.filter(item => item.status === "succeeded").length,
      failed: runRows.filter(item => item.status === "failed").length,
    },
    runtime: {
      ready: runtimeReady && !runtime.error && !!runtime.data,
      paused: runtime.data?.globally_paused === true,
      reason: runtime.data?.pause_reason || null,
      pausedAt: runtime.data?.paused_at || null,
      updatedAt: runtime.data?.updated_at || null,
    },
    limits: {
      ready: limitsReady && !rateControl.error && !hourlyUsage.error && !rateLimitedEvents.error && !!rateControl.data,
      hourlyLimit: rateControl.data?.hourly_run_limit || 100,
      usedThisHour: hourlyUsage.count || 0,
      rateLimited24h: rateLimitedEvents.count || 0,
    },
    alerts: {
      ready: alertsReady && !failureAlerts.error,
      openCount: failureAlerts.count || 0,
      items: alertRows,
    },
    performance: {
      ready: reportingReady && !performance.error,
      days: performanceDays,
      totalRuns: performanceMetric("total_runs"),
      preparedDrafts: performanceMetric("prepared_drafts"),
      approvedDrafts: performanceMetric("approved_drafts"),
      deliveredReplies: performanceMetric("delivered_replies"),
      declinedDrafts: performanceMetric("declined_drafts"),
      failedRuns: performanceMetric("failed_runs"),
      activeRuns: performanceMetric("active_runs"),
      averageSuccessSeconds: performanceMetric("average_success_seconds"),
    },
    worker: {
      ready: workerReady && !workerCycles.error,
      state: workerState,
      latestStartedAt: latestCycle?.started_at || null,
      lastSuccessAt: lastSuccess?.completed_at || null,
      recentFailures: cycleRows.filter(cycle => cycle.status === "failed" && new Date(cycle.started_at).getTime() >= failureCutoff).length,
      latestFailureCode: latestCycle?.status === "failed" ? latestCycle.failure_code : null,
    },
  };
}

export async function getAuditEvents(
  supabase: SupabaseClient,
  organizationId: string,
  filters: { query?: string; category?: string; period?: string } = {},
): Promise<AuditData> {
  const categoryPrefixes: Record<string, string> = {
    crm: "crm.%",
    outreach: "outreach.%",
    email: "email.%",
    recovery: "recovery.%",
    automation: "automation.%",
  };
  const periodDays: Record<string, number> = { day: 1, week: 7, month: 30 };
  let request = supabase
    .from("audit_events")
    .select("id,actor_user_id,event_type,target_type,target_id,metadata,created_at", { count: "exact" })
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(200);

  const prefix = categoryPrefixes[filters.category || ""];
  if (prefix) request = request.like("event_type", prefix);
  const days = periodDays[filters.period || ""];
  if (days) request = request.gte("created_at", new Date(Date.now() - days * 86_400_000).toISOString());

  const { data, error, count } = await request;
  logQueryError("audit events", error);
  const needle = filters.query?.trim().toLowerCase() || "";
  const rows = (data ?? []).filter(event => !needle || [event.event_type, event.target_type, event.target_id]
    .some(value => String(value || "").toLowerCase().includes(needle)));

  return {
    events: rows.map(event => ({
      id: event.id,
      actorUserId: event.actor_user_id,
      eventType: event.event_type,
      targetType: event.target_type,
      targetId: event.target_id,
      metadata: event.metadata && typeof event.metadata === "object" && !Array.isArray(event.metadata) ? event.metadata as Record<string, unknown> : {},
      createdAt: event.created_at,
    })),
    total: needle ? rows.length : count ?? rows.length,
    limited: !needle && (count ?? 0) > 200,
  };
}

export async function getReplyControlsReady(supabase: SupabaseClient) {
  const { data, error } = await supabase.rpc("dashboard_reply_controls_ready");
  return !error && data === true;
}

export async function getContactDetail(supabase: SupabaseClient, organizationId: string, kind: string, id: string): Promise<ContactDetail | null> {
  if (kind === "prospect") {
    const [identity, sends, replies] = await Promise.all([
      supabase.from("prospects").select("id,email,first_name,last_name,company,title,status,linkedin_url,created_at,updated_at").eq("organization_id", organizationId).eq("id", id).maybeSingle(),
      supabase.from("outreach_sends").select("id,status,step_number,sent_at,replied_at,created_at,updated_at,campaign:campaigns(name)").eq("prospect_id", id).order("updated_at", { ascending: false }).limit(100),
      supabase.from("prospect_replies").select("id,subject,body,received_at,created_at").eq("prospect_id", id).order("received_at", { ascending: false }).limit(100),
    ]);
    if (identity.error || !identity.data) return null;
    const prospect = identity.data;
    const timeline = [
      ...(replies.data ?? []).map(reply => ({ id: `reply-${reply.id}`, type: "reply", title: reply.subject || "Reply received", detail: String(reply.body || "Email reply received").replace(/\s+/g, " ").slice(0, 240), occurredAt: reply.received_at || reply.created_at })),
      ...(sends.data ?? []).map(send => { const campaign = one(send.campaign as Related<{ name: string }>); return { id: `send-${send.id}`, type: "outreach", title: `Outreach ${send.status}`, detail: `${campaign?.name || "Campaign"} · Step ${send.step_number}`, occurredAt: send.replied_at || send.sent_at || send.updated_at || send.created_at }; }),
      { id: `created-${prospect.id}`, type: "record", title: "Prospect added", detail: prospect.company || prospect.email, occurredAt: prospect.created_at },
    ].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
    return {
      id: prospect.id,
      kind: "prospect",
      name: [prospect.first_name, prospect.last_name].filter(Boolean).join(" ") || prospect.email,
      email: prospect.email,
      company: prospect.company || "—",
      title: prospect.title || "Prospect",
      status: (sends.data ?? []).some(send => send.status === "replied") ? "replied" : prospect.status,
      facts: [{ label: "Source", value: "Outreach prospect" }, { label: "LinkedIn", value: prospect.linkedin_url ? "Connected" : "Not available" }, { label: "Added", value: formatWhen(prospect.created_at) }],
      timeline,
    };
  }

  if (kind === "customer") {
    const [identity, cases] = await Promise.all([
      supabase.from("crm_customers").select("id,email,name,status,email_enabled,slack_enabled,stripe_customer_id,created_at,updated_at").eq("organization_id", organizationId).eq("id", id).maybeSingle(),
      supabase.from("payment_recovery_cases").select("id,state,invoice_status,amount_remaining,currency,opened_at,resolved_at,updated_at,payment_recovery_messages(id,channel,status,step_number,scheduled_for,sent_at,last_error,updated_at)").eq("crm_customer_id", id).order("updated_at", { ascending: false }).limit(50),
    ]);
    if (identity.error || !identity.data) return null;
    const customer = identity.data;
    const timeline = [
      ...(cases.data ?? []).flatMap(recovery => {
        const messages = (recovery.payment_recovery_messages ?? []) as Array<{ id: string; channel: string; status: string; step_number: number; scheduled_for: string; sent_at: string | null; last_error: string | null; updated_at: string }>;
        return [
          { id: `case-${recovery.id}`, type: "payment", title: `Payment recovery ${recovery.state}`, detail: `${formatMoney(Number(recovery.amount_remaining), recovery.currency)} · Invoice ${recovery.invoice_status}`, occurredAt: recovery.resolved_at || recovery.updated_at || recovery.opened_at },
          ...messages.map(message => ({ id: `message-${message.id}`, type: "delivery", title: `${message.channel === "slack" ? "Slack" : "Email"} reminder ${message.status}`, detail: message.last_error || `Recovery step ${message.step_number}`, occurredAt: message.sent_at || message.updated_at || message.scheduled_for })),
        ];
      }),
      { id: `created-${customer.id}`, type: "record", title: "Client record created", detail: customer.email || customer.stripe_customer_id, occurredAt: customer.created_at },
    ].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
    return {
      id: customer.id,
      kind: "customer",
      name: customer.name || customer.email || "Unnamed client",
      email: customer.email || "—",
      company: "EpsiFlow client",
      title: "Stripe customer",
      status: (cases.data ?? []).some(recovery => recovery.state === "open") ? "recovery open" : customer.status,
      facts: [{ label: "Email channel", value: customer.email_enabled ? "Enabled" : "Disabled" }, { label: "Slack channel", value: customer.slack_enabled ? "Enabled" : "Disabled" }, { label: "Stripe ID", value: customer.stripe_customer_id }],
      timeline,
    };
  }

  return null;
}
