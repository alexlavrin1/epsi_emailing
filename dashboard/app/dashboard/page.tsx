import type { Metadata } from "next";
import Link from "next/link";
import { AlertCircle, ArrowRight, Banknote, MailCheck, Megaphone, Send, Users } from "lucide-react";
import { requireMembership } from "../../lib/auth";
import { createSupabaseServerClient } from "../../lib/supabase-server";
import { formatWhen, getOverviewData } from "../../lib/dashboard-data";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Operations overview" };

const metricIcons = [Users, Megaphone, MailCheck, Banknote];

export default async function DashboardPage() {
  const { user, membership } = await requireMembership();
  if (!membership) return null;
  const supabase = await createSupabaseServerClient();
  if (!supabase) throw new Error("Dashboard authentication is not configured.");
  const data = await getOverviewData(supabase, membership.organization.id);
  const firstName = user.user_metadata?.full_name?.split(" ")[0] || user.email?.split("@")[0] || "Operator";
  const metrics = [
    { label: "Known contacts", value: data.metrics.contacts, detail: "Prospects and clients" },
    { label: "Active campaigns", value: data.metrics.activeCampaigns, detail: `${data.metrics.scheduledSends} sends scheduled` },
    { label: "Replies received", value: data.metrics.replies, detail: "Across outreach" },
    { label: "Open recoveries", value: data.metrics.openRecoveries, detail: "Payment cases" },
  ];

  return (
    <main className="dashboard-main" id="main-content">
      <header className="topbar"><div><p className="eyebrow">{membership.organization.name} · Operations</p><h1>Good to see you, {firstName}.</h1><p className="page-summary">A live, read-only view of clients, outreach, replies, and payment recovery.</p></div><div className="system-status"><span /> Data connected</div></header>

      <section className="metric-grid" aria-label="Workspace metrics">
        {metrics.map((metric, index) => { const Icon = metricIcons[index]; return <article className="metric-card" key={metric.label}><div className="metric-heading"><span>{metric.label}</span><Icon size={18} aria-hidden="true" /></div><strong>{metric.value.toLocaleString()}</strong><p>{metric.detail}</p></article>; })}
      </section>

      <section className="content-grid">
        <article className="panel attention-panel" aria-labelledby="attention-heading">
          <div className="panel-heading"><div><p className="eyebrow">Priority</p><h2 id="attention-heading">Attention queue</h2></div><span className="count-badge">{data.attention.length}</span></div>
          {data.attention.length ? <div className="attention-list">{data.attention.map(item => <Link className="attention-item" href={item.href} key={item.id}><span className={`attention-dot ${item.tone}`} aria-hidden="true" /><span><strong>{item.title}</strong><small>{item.detail}</small></span><ArrowRight size={17} aria-hidden="true" /></Link>)}</div> : <div className="empty-state"><AlertCircle size={22} aria-hidden="true" /><strong>No urgent exceptions</strong><p>Failed deliveries and overdue payment actions will appear here.</p></div>}
        </article>

        <article className="panel" aria-labelledby="activity-heading">
          <div className="panel-heading"><div><p className="eyebrow">Live feed</p><h2 id="activity-heading">Recent activity</h2></div><Link className="panel-link" href="/dashboard/crm">View CRM</Link></div>
          {data.activity.length ? <ol className="activity-list">{data.activity.map(item => <li key={item.id}><span className={`activity-icon ${item.type}`}><Send size={15} aria-hidden="true" /></span><Link href={item.href}><strong>{item.title}</strong><small>{item.detail}</small></Link><time dateTime={item.occurredAt}>{formatWhen(item.occurredAt)}</time></li>)}</ol> : <div className="empty-state"><Send size={22} aria-hidden="true" /><strong>No client activity yet</strong><p>Replies, outreach, and payment events will form a unified timeline.</p></div>}
        </article>
      </section>
    </main>
  );
}
