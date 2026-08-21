import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Clock3, Mail, UserRound } from "lucide-react";
import { notFound } from "next/navigation";
import { requireMembership } from "../../../../../lib/auth";
import { createSupabaseServerClient } from "../../../../../lib/supabase-server";
import { formatWhen, getContactDetail } from "../../../../../lib/dashboard-data";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Contact detail" };

export default async function ContactDetailPage({ params }: { params: Promise<{ kind: string; id: string }> }) {
  const { membership } = await requireMembership();
  if (!membership) return null;
  const { kind, id } = await params;
  const supabase = await createSupabaseServerClient();
  if (!supabase) throw new Error("Dashboard authentication is not configured.");
  const contact = await getContactDetail(supabase, membership.organization.id, kind, id);
  if (!contact) notFound();
  return (
    <main className="dashboard-main" id="main-content">
      <Link className="back-row" href="/dashboard/crm"><ArrowLeft size={16} aria-hidden="true" />Back to CRM</Link>
      <header className="contact-header"><div className="contact-avatar"><UserRound size={28} aria-hidden="true" /></div><div><p className="eyebrow">{contact.kind === "customer" ? "Client" : "Prospect"}</p><h1>{contact.name}</h1><p>{contact.title} · {contact.company}</p></div><span className={`status-badge status-${contact.status.replace(/\s+/g, "-")}`}>{contact.status}</span></header>
      <section className="contact-layout">
        <aside className="panel identity-panel"><h2>Contact details</h2><a className="identity-email" href={`mailto:${contact.email}`}><Mail size={16} aria-hidden="true" />{contact.email}</a><dl>{contact.facts.map(fact => <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}</dl></aside>
        <section className="panel timeline-panel" aria-labelledby="timeline-heading"><div className="panel-heading"><div><p className="eyebrow">Unified history</p><h2 id="timeline-heading">Activity timeline</h2></div><span className="count-badge">{contact.timeline.length}</span></div>{contact.timeline.length ? <ol className="contact-timeline">{contact.timeline.map(item => <li key={item.id}><span className={`timeline-marker ${item.type}`} aria-hidden="true" /><div><strong>{item.title}</strong><p>{item.detail}</p><time dateTime={item.occurredAt}><Clock3 size={13} aria-hidden="true" />{formatWhen(item.occurredAt)}</time></div></li>)}</ol> : <div className="empty-state"><Clock3 size={22} aria-hidden="true" /><strong>No activity yet</strong></div>}</section>
      </section>
    </main>
  );
}
