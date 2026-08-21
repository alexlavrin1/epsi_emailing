import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CircleDollarSign, Columns3, MessageSquareText } from "lucide-react";
import { requireMembership } from "../../../lib/auth";
import { createSupabaseServerClient } from "../../../lib/supabase-server";
import { formatWhen, getPipeline, getSlackHealth } from "../../../lib/dashboard-data";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Lifecycle pipeline" };

export default async function PipelinePage() {
  const { membership } = await requireMembership();
  if (!membership) return null;
  const supabase = await createSupabaseServerClient();
  if (!supabase) throw new Error("Dashboard authentication is not configured.");
  const [stages, slack] = await Promise.all([
    getPipeline(supabase, membership.organization.id),
    getSlackHealth(supabase, membership.organization.id),
  ]);
  const total = stages.reduce((sum, stage) => sum + stage.contacts.length, 0);

  return (
    <main className="dashboard-main" id="main-content">
      <header className="page-header"><div><p className="eyebrow">Canonical CRM view</p><h1>Lifecycle pipeline</h1><p className="page-summary">One contact per email, classified from outreach replies, client status, and payment recovery.</p></div><span className="record-count">{total} unique contacts</span></header>

      <section className="pipeline-summary" aria-label="Lifecycle stage counts">
        {stages.map(stage => <article key={stage.id}><span className={`stage-signal stage-${stage.id}`} aria-hidden="true" /><div><strong>{stage.contacts.length}</strong><span>{stage.label}</span></div></article>)}
      </section>

      <section className="pipeline-grid" aria-label="Contact lifecycle pipeline">
        {stages.map(stage => (
          <article className="pipeline-column" key={stage.id}>
            <header><div><span className={`stage-signal stage-${stage.id}`} aria-hidden="true" /><h2>{stage.label}</h2></div><span className="count-badge">{stage.contacts.length}</span><p>{stage.description}</p></header>
            {stage.contacts.length ? <ol>{stage.contacts.slice(0, 12).map(contact => <li key={contact.key}><Link href={`/dashboard/crm/${contact.kind}/${contact.id}`}><span className="pipeline-card-heading"><strong>{contact.name}</strong><ArrowRight size={15} aria-hidden="true" /></span><span>{contact.company}</span><small>{contact.channels} · {formatWhen(contact.lastActivity)}</small></Link></li>)}</ol> : <div className="pipeline-empty">No contacts in this stage</div>}
            {stage.contacts.length > 12 ? <Link className="pipeline-more" href="/dashboard/crm">View {stage.contacts.length - 12} more in CRM</Link> : null}
          </article>
        ))}
      </section>

      <section className="panel channel-panel" aria-labelledby="slack-health-heading">
        <div className="panel-heading"><div><p className="eyebrow">Channel health</p><h2 id="slack-health-heading">Slack recovery delivery</h2></div><span className={`status-badge ${slack.failed ? "status-failed" : "status-active"}`}>{slack.failed ? `${slack.failed} failed` : "Healthy"}</span></div>
        <div className="channel-layout">
          <dl className="channel-stats">
            <div><dt>Mapped clients</dt><dd>{slack.mappedClients}</dd></div>
            <div><dt>Slack enabled</dt><dd>{slack.enabledClients}</dd></div>
            <div><dt>Queued</dt><dd>{slack.queued}</dd></div>
            <div><dt>Sent</dt><dd>{slack.sent}</dd></div>
          </dl>
          <div className="channel-activity">
            {slack.recent.length ? <ol>{slack.recent.map(item => <li key={item.id}><span className={`channel-icon ${item.status === "failed" ? "failed" : ""}`}><MessageSquareText size={15} aria-hidden="true" /></span><span><strong>{item.customer}</strong><small>Step {item.step} · Slack reminder {item.status}{item.error ? ` · ${item.error}` : ""}</small></span><time dateTime={item.occurredAt}>{formatWhen(item.occurredAt)}</time>{item.customerId ? <Link href={`/dashboard/crm/customer/${item.customerId}`} aria-label={`Open ${item.customer}`}><ArrowRight size={16} /></Link> : null}</li>)}</ol> : <div className="empty-state channel-empty"><CircleDollarSign size={22} aria-hidden="true" /><strong>No Slack recovery activity yet</strong><p>Mapped clients and outbound Slack reminders will appear here.</p></div>}
          </div>
        </div>
      </section>

      <p className="data-boundary"><Columns3 size={15} aria-hidden="true" /> Lifecycle stages are computed from current records. Stage editing and manual overrides arrive in Phase 3 with audit logging.</p>
    </main>
  );
}
