import type { Metadata } from "next";
import Link from "next/link";
import { Activity, CheckCircle2, LockKeyhole, ShieldCheck } from "lucide-react";
import { requireMembership } from "../../lib/auth";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const { user, membership } = await requireMembership();
  if (!membership) {
    return (
      <main className="pending-shell" id="main-content"><section className="pending-card">
        <LockKeyhole aria-hidden="true" size={28} /><p className="eyebrow">Access pending</p>
        <h1>Your account is authenticated.</h1>
        <p>{user.email} has not yet been assigned to an EpsiFlow organization. Ask an administrator to add your membership.</p>
        <form action="/api/auth/logout" method="post"><button className="secondary-button" type="submit">Sign out</button></form>
      </section></main>
    );
  }

  const firstName = user.user_metadata?.full_name?.split(" ")[0] || user.email?.split("@")[0] || "Operator";
  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Primary navigation">
        <Link className="brand" href="/dashboard" aria-label="EpsiFlow dashboard"><span className="brand-mark" aria-hidden="true">E</span><span>EpsiFlow</span></Link>
        <nav><Link className="nav-link active" href="/dashboard"><Activity size={18} />Overview</Link><span className="nav-section">Coming next</span><span className="nav-link disabled">CRM</span><span className="nav-link disabled">Inbox</span><span className="nav-link disabled">Automations</span></nav>
        <div className="sidebar-footer"><span className="role-badge">{membership.role}</span><strong>{user.email}</strong><form action="/api/auth/logout" method="post"><button className="text-button" type="submit">Sign out</button></form></div>
      </aside>
      <main className="dashboard-main" id="main-content">
        <header className="topbar"><div><p className="eyebrow">{membership.organization.name}</p><h1>Good to see you, {firstName}.</h1></div><div className="system-status"><span /> Engine boundary protected</div></header>
        <section className="foundation-hero" aria-labelledby="foundation-heading"><div><p className="eyebrow">Phase 1</p><h2 id="foundation-heading">Security foundation is active.</h2><p>Identity, organization access, and server-side permission checks now sit between operators and sensitive EpsiFlow data.</p></div><ShieldCheck size={52} aria-hidden="true" /></section>
        <section className="foundation-grid" aria-label="Foundation status">
          {[["Authentication", "Invite-only Supabase sessions"], ["Authorization", `${membership.role} access in ${membership.organization.name}`], ["Data isolation", "Organization-scoped RLS policies"], ["Audit trail", "Append-only security events"]].map(([title, detail]) => (
            <article className="foundation-card" key={title}><div className="card-icon"><CheckCircle2 size={19} aria-hidden="true" /></div><div><h3>{title}</h3><p>{detail}</p></div><span className="ready-label">Ready</span></article>
          ))}
        </section>
        <section className="next-section"><div><p className="eyebrow">Next milestone</p><h2>Read-only CRM overview</h2></div><p>Phase 2 will connect client records, replies, payment recovery, and outreach activity into one timeline.</p></section>
      </main>
    </div>
  );
}
