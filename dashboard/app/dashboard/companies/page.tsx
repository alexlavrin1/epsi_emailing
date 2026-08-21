import type { Metadata } from "next";
import { Building2 } from "lucide-react";
import { requireMembership } from "../../../lib/auth";
import { createSupabaseServerClient } from "../../../lib/supabase-server";
import { formatWhen, getCompanies } from "../../../lib/dashboard-data";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Companies" };

export default async function CompaniesPage() {
  const { membership } = await requireMembership();
  if (!membership) return null;
  const supabase = await createSupabaseServerClient();
  if (!supabase) throw new Error("Dashboard authentication is not configured.");
  const companies = await getCompanies(supabase, membership.organization.id);
  return (
    <main className="dashboard-main" id="main-content">
      <header className="page-header"><div><p className="eyebrow">Accounts</p><h1>Companies</h1><p className="page-summary">Outreach relationships grouped by company.</p></div><span className="record-count">{companies.length} companies</span></header>
      {companies.length ? <section className="company-grid" aria-label="Companies">{companies.map(company => <article className="company-card" key={company.name}><div className="company-icon"><Building2 size={19} aria-hidden="true" /></div><div><h2>{company.name}</h2><p>{company.contacts} contacts · {company.active} active</p></div><div className="company-stats"><span><strong>{company.replied}</strong> replied</span><time dateTime={company.lastActivity}>{formatWhen(company.lastActivity)}</time></div></article>)}</section> : <div className="empty-state large-empty"><Building2 size={28} aria-hidden="true" /><strong>No companies yet</strong><p>Company groupings appear when prospects include a company name.</p></div>}
    </main>
  );
}
