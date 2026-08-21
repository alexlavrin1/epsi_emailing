import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Search, Users } from "lucide-react";
import { requireMembership } from "../../../lib/auth";
import { createSupabaseServerClient } from "../../../lib/supabase-server";
import { formatWhen, getContacts } from "../../../lib/dashboard-data";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "CRM" };

export default async function CrmPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string }> }) {
  const { membership } = await requireMembership();
  if (!membership) return null;
  const params = await searchParams;
  const query = params.q?.trim() || "";
  const status = params.status || "all";
  const supabase = await createSupabaseServerClient();
  if (!supabase) throw new Error("Dashboard authentication is not configured.");
  const contacts = await getContacts(supabase, membership.organization.id, query, status);

  return (
    <main className="dashboard-main" id="main-content">
      <header className="page-header"><div><p className="eyebrow">Read-only CRM</p><h1>Contacts and clients</h1><p className="page-summary">Prospects and paying clients unified into one operational list.</p></div><span className="record-count">{contacts.length} records</span></header>
      <form className="filter-bar" method="get" role="search">
        <label className="search-field"><Search size={17} aria-hidden="true" /><span className="sr-only">Search contacts</span><input name="q" defaultValue={query} placeholder="Search name, email, company…" /></label>
        <label><span className="sr-only">Filter by status</span><select name="status" defaultValue={status}><option value="all">All statuses</option><option value="active">Active</option><option value="replied">Replied</option><option value="recovery open">Recovery open</option><option value="suppressed">Suppressed</option><option value="bounced">Bounced</option><option value="unsubscribed">Unsubscribed</option></select></label>
        <button className="secondary-button compact-button" type="submit">Apply</button>
        {(query || status !== "all") ? <Link className="clear-filter" href="/dashboard/crm">Clear</Link> : null}
      </form>

      {contacts.length ? <div className="table-shell"><table className="data-table"><thead><tr><th>Contact</th><th>Company / type</th><th>Status</th><th>Channel</th><th>Last activity</th><th><span className="sr-only">Open</span></th></tr></thead><tbody>{contacts.map(contact => <tr key={`${contact.kind}-${contact.id}`}><td><Link className="contact-cell" href={`/dashboard/crm/${contact.kind}/${contact.id}`}><span className="avatar" aria-hidden="true">{contact.name.charAt(0).toUpperCase()}</span><span><strong>{contact.name}</strong><small>{contact.email}</small></span></Link></td><td>{contact.company}</td><td><span className={`status-badge status-${contact.status.replace(/\s+/g, "-")}`}>{contact.status}</span></td><td>{contact.channel}</td><td>{formatWhen(contact.lastActivity)}</td><td><Link className="row-action" href={`/dashboard/crm/${contact.kind}/${contact.id}`} aria-label={`Open ${contact.name}`}><ArrowRight size={17} /></Link></td></tr>)}</tbody></table></div> : <div className="empty-state large-empty"><Users size={28} aria-hidden="true" /><strong>No matching contacts</strong><p>Adjust the search or filter to see more CRM records.</p></div>}
    </main>
  );
}
