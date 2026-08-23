import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, BriefcaseBusiness, Globe2, Mail, MessageSquareText, Users } from "lucide-react";
import { requireMembership } from "../../../lib/auth";
import { createSupabaseServerClient } from "../../../lib/supabase-server";
import { getClientApps } from "../../../lib/client-data";
import { ClientCreateForm } from "../../components/client-forms";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const metadata: Metadata = { title: "Clients" };

export default async function ClientsPage() {
  const { membership } = await requireMembership();
  if (!membership) return null;
  const supabase = await createSupabaseServerClient();
  const data = supabase ? await getClientApps(supabase, membership.organization.id) : { ready: false, apps: [] };
  const contacts = data.apps.reduce((total, app) => total + app.contacts.length, 0);
  const assignedChats = data.apps.flatMap(app => app.contacts).filter(contact => contact.slackStatus === "assigned").length;
  return <main className="dashboard-main" id="main-content">
    <header className="page-header"><div><p className="eyebrow">Existing relationships</p><h1>Clients</h1><p className="page-summary">Connect each client app to its people, matching mailbox correspondence and assigned Slack conversations.</p></div><span className="record-count">{data.apps.length} apps · {contacts} contacts</span></header>
    {!data.ready ? <section className="panel setup-panel client-setup"><BriefcaseBusiness size={20} aria-hidden="true" /><div><strong>The Clients workspace is ready to install</strong><p>Apply migration 025 to add client apps, multiple contacts, email matching, and Slack chat assignment.</p></div></section> : <>
      <section className="client-summary" aria-label="Client workspace summary"><article><BriefcaseBusiness size={18} aria-hidden="true" /><span>Client apps</span><strong>{data.apps.length}</strong></article><article><Users size={18} aria-hidden="true" /><span>Contact people</span><strong>{contacts}</strong></article><article><MessageSquareText size={18} aria-hidden="true" /><span>Assigned Slack chats</span><strong>{assignedChats}</strong></article></section>
      <section className="panel client-create-panel" aria-labelledby="add-client-heading"><div className="panel-heading"><div><p className="eyebrow">New record</p><h2 id="add-client-heading">Add an existing client</h2></div><BriefcaseBusiness size={19} aria-hidden="true" /></div><p className="client-form-intro">Start with the app and one primary contact. You can add more people from the client page.</p><ClientCreateForm /></section>
      <section className="client-list-section" aria-labelledby="client-list-heading"><div className="section-heading"><div><p className="eyebrow">Connected workspace</p><h2 id="client-list-heading">Client apps</h2></div><span className="count-badge">{data.apps.length}</span></div>
        {data.apps.length ? <div className="client-app-grid">{data.apps.map(app => { const slackCount = app.contacts.filter(contact => contact.slackStatus === "assigned").length; return <Link className="client-app-card" href={`/dashboard/clients/${app.id}`} key={app.id}><span className="client-app-icon"><BriefcaseBusiness size={19} aria-hidden="true" /></span><div><h3>{app.name}</h3><p><Globe2 size={13} aria-hidden="true" />{new URL(app.websiteUrl).hostname}</p><small><Mail size={12} aria-hidden="true" />{app.contacts.length} contact{app.contacts.length === 1 ? "" : "s"} · {slackCount} Slack chat{slackCount === 1 ? "" : "s"}</small></div><ArrowRight size={18} aria-hidden="true" /></Link>; })}</div> : <div className="empty-state client-empty"><BriefcaseBusiness size={25} aria-hidden="true" /><strong>No existing clients yet</strong><p>Add the first app above. Mail correspondence will appear after the next engine cycle.</p></div>}
      </section>
    </>}
  </main>;
}
