import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, BriefcaseBusiness, CreditCard, Globe2, Mail, MessageSquareText, Users } from "lucide-react";
import { requireMembership } from "../../../lib/auth";
import { createSupabaseServerClient } from "../../../lib/supabase-server";
import { getClientApps, type ClientAppSummary } from "../../../lib/client-data";
import { ClientCreateForm } from "../../components/client-forms";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const metadata: Metadata = { title: "Clients" };

type ClientTypeFilter = "all" | "leads" | "churned" | "clients";

function clientType(app: ClientAppSummary): Exclude<ClientTypeFilter, "all"> {
  if (app.relationshipState === "churned") return "churned";
  if (app.clientSegment === "lead") return "leads";
  return "clients";
}

export default async function ClientsPage({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  const { membership } = await requireMembership();
  if (!membership) return null;
  const supabase = await createSupabaseServerClient();
  const data = supabase ? await getClientApps(supabase, membership.organization.id) : { ready: false, apps: [] };
  const params = await searchParams;
  const filter: ClientTypeFilter = params.type === "leads" || params.type === "churned" || params.type === "clients" ? params.type : "all";
  const visibleApps = filter === "all" ? data.apps : data.apps.filter(app => clientType(app) === filter);
  const contacts = data.apps.reduce((total, app) => total + app.contacts.length, 0);
  const assignedChats = data.apps.flatMap(app => app.contacts).filter(contact => contact.slackStatus === "assigned" || contact.slackStatus === "linked").length;
  const churned = data.apps.filter(app => app.relationshipState === "churned").length;
  const tab = (value: ClientTypeFilter, label: string) => <Link href={value === "all" ? "/dashboard/clients" : `/dashboard/clients?type=${value}`} aria-current={filter === value ? "page" : undefined}>{label}</Link>;
  return <main className="dashboard-main" id="main-content">
    <header className="page-header"><div><p className="eyebrow">Existing relationships</p><h1>Clients</h1><p className="page-summary">Connect each client app to its people, matching mailbox correspondence and assigned Slack conversations.</p></div><span className="record-count">{data.apps.length} apps · {contacts} contacts</span></header>
    {!data.ready ? <section className="panel setup-panel client-setup"><BriefcaseBusiness size={20} aria-hidden="true" /><div><strong>The Clients workspace is ready to install</strong><p>Apply migration 025 to add client apps, multiple contacts, email matching, and Slack chat assignment.</p></div></section> : <>
      <section className="client-summary" aria-label="Client workspace summary"><article><BriefcaseBusiness size={18} aria-hidden="true" /><span>Client apps</span><strong>{data.apps.length}</strong></article><article><Users size={18} aria-hidden="true" /><span>Contact people</span><strong>{contacts}</strong></article><article><MessageSquareText size={18} aria-hidden="true" /><span>Assigned Slack chats</span><strong>{assignedChats}</strong></article><article><Users size={18} aria-hidden="true" /><span>Churned</span><strong>{churned}</strong></article></section>
      <section className="panel client-create-panel" aria-labelledby="add-client-heading"><div className="panel-heading"><div><p className="eyebrow">New record</p><h2 id="add-client-heading">Add an existing client</h2></div><BriefcaseBusiness size={19} aria-hidden="true" /></div><p className="client-form-intro">Start with the app and one primary contact. You can add more people from the client page.</p><ClientCreateForm /></section>
      <section className="client-list-section" aria-labelledby="client-list-heading"><div className="section-heading"><div><p className="eyebrow">Connected workspace</p><h2 id="client-list-heading">Client apps</h2></div><nav className="performance-range client-type-filter" aria-label="Filter clients by type">{tab("all", "All")}{tab("leads", "Leads")}{tab("clients", "Clients")}{tab("churned", "Churned")}</nav><span className="count-badge">{visibleApps.length}</span></div>
        {visibleApps.length ? <div className="client-app-grid">{visibleApps.map(app => { const slackCount = app.contacts.filter(contact => contact.slackStatus === "assigned" || contact.slackStatus === "linked").length; return <Link className="client-app-card" href={`/dashboard/clients/${app.id}`} key={app.id}><span className="client-app-icon"><BriefcaseBusiness size={19} aria-hidden="true" /></span><div><span className={`status-badge status-${app.relationshipState}`}>{app.relationshipState}</span><h3>{app.name}</h3><p><Globe2 size={13} aria-hidden="true" />{new URL(app.websiteUrl).hostname}</p>{app.plan ? <small className="client-app-plan"><CreditCard size={12} aria-hidden="true" />{app.plan.label}{app.plan.price ? ` · ${app.plan.price}` : ""} · {app.plan.status.replaceAll("_", " ")}</small> : null}<small><Mail size={12} aria-hidden="true" />{app.contacts.length} contact{app.contacts.length === 1 ? "" : "s"} · {slackCount} Slack chat{slackCount === 1 ? "" : "s"}</small></div><ArrowRight size={18} aria-hidden="true" /></Link>; })}</div> : <div className="empty-state client-empty"><BriefcaseBusiness size={25} aria-hidden="true" /><strong>{filter === "all" ? "No existing clients yet" : `No ${filter} to show`}</strong><p>{filter === "all" ? "Add the first app above. Mail correspondence will appear after the next engine cycle." : "Switch filters to see other records."}</p></div>}
      </section>
    </>}
  </main>;
}
