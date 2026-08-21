import Link from "next/link";
import { LockKeyhole } from "lucide-react";
import { DashboardNav } from "../components/dashboard-nav";
import { requireMembership } from "../../lib/auth";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
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

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Primary navigation">
        <Link className="brand" href="/dashboard" aria-label="EpsiFlow dashboard"><span className="brand-mark" aria-hidden="true">E</span><span>EpsiFlow</span></Link>
        <DashboardNav />
        <div className="sidebar-footer"><span className="role-badge">{membership.role}</span><strong>{user.email}</strong><form action="/api/auth/logout" method="post"><button className="text-button" type="submit">Sign out</button></form></div>
      </aside>
      {children}
    </div>
  );
}
