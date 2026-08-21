import type { Metadata } from "next";
import Link from "next/link";
import { Activity, ArrowUpRight, Clock3, FileClock, Search, ShieldCheck, UserRound } from "lucide-react";
import { requireMembership } from "../../../lib/auth";
import { createSupabaseServerClient } from "../../../lib/supabase-server";
import { formatWhen, getAuditEvents, type AuditEvent } from "../../../lib/dashboard-data";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Audit log" };

const eventLabels: Record<string, string> = {
  "crm.lifecycle.changed": "Lifecycle changed",
  "crm.note.created": "Contact note created",
  "crm.task.created": "Follow-up task created",
  "crm.task.status_changed": "Task status changed",
  "outreach.campaign.status_changed": "Campaign status changed",
  "outreach.prospect.stopped": "Contact outreach stopped",
  "email.reply.draft_created": "Reply draft created",
  "email.reply.queued": "Email reply approved",
  "recovery.delivery.retry_queued": "Recovery retry approved",
};

const safeMetadataKeys = new Set([
  "previous_stage", "new_stage", "note_id", "task_id", "due_at", "previous_status", "new_status",
  "contact_kind", "contact_id", "scheduled_sends_stopped", "prospect_reply_id", "channel", "previous_attempt_count",
]);

function readable(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, letter => letter.toUpperCase());
}

function shortId(value: string | null) {
  return value ? `${value.slice(0, 8)}…` : "No target";
}

function safeMetadata(metadata: Record<string, unknown>) {
  return Object.entries(metadata).filter(([key]) => safeMetadataKeys.has(key)).slice(0, 8);
}

function formatMetadataValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "None";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string" || typeof value === "number") return String(value);
  return "Recorded";
}

function eventSummary(event: AuditEvent) {
  const meta = event.metadata;
  switch (event.eventType) {
    case "crm.lifecycle.changed": return `Moved from ${meta.previous_stage || "automatic classification"} to ${meta.new_stage || "a new stage"}.`;
    case "crm.note.created": return "An internal note was added to this CRM record.";
    case "crm.task.created": return meta.due_at ? `A follow-up task was created with a due date.` : "A follow-up task was created without a due date.";
    case "crm.task.status_changed": return `Task changed from ${meta.previous_status || "its previous state"} to ${meta.new_status || "a new state"}.`;
    case "outreach.campaign.status_changed": return `Campaign changed from ${meta.previous_status || "its previous state"} to ${meta.new_status || "a new state"}.`;
    case "outreach.prospect.stopped": return `${meta.scheduled_sends_stopped || 0} scheduled send(s) were stopped.`;
    case "email.reply.draft_created": return "A manual reply was saved as an inert draft for review.";
    case "email.reply.queued": return "A reviewed reply was approved for server-side delivery.";
    case "recovery.delivery.retry_queued": return `A failed ${meta.channel || "recovery"} delivery was approved for retry.`;
    default: return "An operator action was recorded by EpsiFlow.";
  }
}

function targetHref(event: AuditEvent) {
  if ((event.targetType === "prospect" || event.targetType === "customer") && event.targetId) return `/dashboard/crm/${event.targetType}/${event.targetId}`;
  if (event.targetType === "task" && typeof event.metadata.contact_kind === "string" && typeof event.metadata.contact_id === "string") return `/dashboard/crm/${event.metadata.contact_kind}/${event.metadata.contact_id}`;
  if (event.targetType === "campaign") return "/dashboard/campaigns";
  if (event.targetType === "operator_email_reply") return "/dashboard/approvals";
  if (event.targetType === "payment_recovery_message") return "/dashboard/approvals#recovery-retries";
  return null;
}

function eventCategory(eventType: string) {
  return eventType.split(".")[0] || "system";
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ q?: string; category?: string; period?: string }> }) {
  const { user, membership } = await requireMembership();
  if (!membership) return null;
  const params = await searchParams;
  const query = params.q?.trim() || "";
  const category = ["all", "crm", "outreach", "email", "recovery"].includes(params.category || "") ? params.category! : "all";
  const period = ["day", "week", "month", "all"].includes(params.period || "") ? params.period! : "month";
  const supabase = await createSupabaseServerClient();
  if (!supabase) throw new Error("Dashboard authentication is not configured.");
  const data = await getAuditEvents(supabase, membership.organization.id, { query, category, period });
  const filtered = query || category !== "all" || period !== "month";

  return <main className="dashboard-main" id="main-content">
    <header className="page-header"><div><p className="eyebrow">Append-only history</p><h1>Audit log</h1><p className="page-summary">Trace sensitive operator actions, approvals, and state changes across your EpsiFlow workspace.</p></div><span className="record-count">{data.total}{data.limited ? "+" : ""} events</span></header>

    <section className="audit-assurance" aria-label="Audit security properties">
      <span><ShieldCheck size={17} aria-hidden="true" /><strong>Tenant scoped</strong><small>Only your organization</small></span>
      <span><FileClock size={17} aria-hidden="true" /><strong>Append only</strong><small>No browser edits or deletes</small></span>
      <span><Clock3 size={17} aria-hidden="true" /><strong>Newest first</strong><small>Exact timestamps retained</small></span>
    </section>

    <form className="filter-bar audit-filters" method="get" role="search">
      <label className="search-field"><Search size={17} aria-hidden="true" /><span className="sr-only">Search audit events</span><input name="q" defaultValue={query} placeholder="Search action or target ID…" /></label>
      <label><span className="sr-only">Filter by event category</span><select name="category" defaultValue={category}><option value="all">All actions</option><option value="crm">CRM</option><option value="outreach">Outreach</option><option value="email">Email</option><option value="recovery">Recovery</option></select></label>
      <label><span className="sr-only">Filter by time period</span><select name="period" defaultValue={period}><option value="day">Last 24 hours</option><option value="week">Last 7 days</option><option value="month">Last 30 days</option><option value="all">All time</option></select></label>
      <button className="secondary-button compact-button" type="submit">Apply</button>
      {filtered ? <Link className="clear-filter" href="/dashboard/audit">Clear</Link> : null}
    </form>

    {data.events.length ? <section className="audit-list" aria-label="Audit events">{data.events.map(event => {
      const details = safeMetadata(event.metadata);
      const href = targetHref(event);
      const categoryName = eventCategory(event.eventType);
      return <article className="audit-event" key={event.id}>
        <span className={`audit-event-icon audit-${categoryName}`} aria-hidden="true"><Activity size={17} /></span>
        <div className="audit-event-main"><div className="audit-event-title"><span className={`status-badge audit-category audit-${categoryName}`}>{categoryName}</span><h2>{eventLabels[event.eventType] || readable(event.eventType)}</h2></div><p>{eventSummary(event)}</p><code>{event.eventType}</code>
          {details.length ? <details className="audit-details"><summary>View recorded details</summary><dl>{details.map(([key, value]) => <div key={key}><dt>{readable(key)}</dt><dd>{formatMetadataValue(value)}</dd></div>)}</dl></details> : null}
        </div>
        <div className="audit-event-context"><span><UserRound size={13} aria-hidden="true" />{event.actorUserId === user.id ? "You" : event.actorUserId ? `Operator ${shortId(event.actorUserId)}` : "System"}</span>{href ? <Link href={href}>{readable(event.targetType || "record")} · {shortId(event.targetId)}<ArrowUpRight size={13} aria-hidden="true" /></Link> : <span>{readable(event.targetType || "record")} · {shortId(event.targetId)}</span>}<time dateTime={event.createdAt} title={new Date(event.createdAt).toLocaleString()}>{formatWhen(event.createdAt)}</time></div>
      </article>;
    })}</section> : <div className="empty-state large-empty"><FileClock size={28} aria-hidden="true" /><strong>No matching audit events</strong><p>Actions performed through EpsiFlow’s guarded controls will appear here. Adjust the filters to search a wider period.</p></div>}
    {data.limited ? <p className="audit-limit-note">Showing the newest 200 events. Narrow the filters to inspect a specific action or time period.</p> : null}
  </main>;
}
