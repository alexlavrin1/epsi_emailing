"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, Archive, Building2, CheckCheck, Columns3, FileClock, Inbox, LayoutDashboard, Megaphone, Users, Workflow } from "lucide-react";

const items = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard, exact: true },
  { href: "/dashboard/crm", label: "CRM", icon: Users },
  { href: "/dashboard/pipeline", label: "Pipeline", icon: Columns3 },
  { href: "/dashboard/companies", label: "Companies", icon: Building2 },
  { href: "/dashboard/inbox", label: "Replies", icon: Inbox },
];

export function DashboardNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Workspace">
      {items.map(({ href, label, icon: Icon, exact }) => {
        const active = exact ? pathname === href : pathname.startsWith(href);
        return <Link className={`nav-link${active ? " active" : ""}`} href={href} key={href} aria-current={active ? "page" : undefined}><Icon size={18} aria-hidden="true" /><span>{label}</span></Link>;
      })}
      <span className="nav-section">Automation</span>
      <Link className={`nav-link automation-link${pathname.startsWith("/dashboard/approvals") ? " active" : ""}`} href="/dashboard/approvals" aria-current={pathname.startsWith("/dashboard/approvals") ? "page" : undefined}><CheckCheck size={18} aria-hidden="true" /><span>Approvals</span></Link>
      <Link className={`nav-link automation-link${pathname.startsWith("/dashboard/campaigns") ? " active" : ""}`} href="/dashboard/campaigns" aria-current={pathname.startsWith("/dashboard/campaigns") ? "page" : undefined}><Megaphone size={18} aria-hidden="true" /><span>Campaigns</span></Link>
      <Link className={`nav-link automation-link${pathname.startsWith("/dashboard/audit") ? " active" : ""}`} href="/dashboard/audit" aria-current={pathname.startsWith("/dashboard/audit") ? "page" : undefined}><FileClock size={18} aria-hidden="true" /><span>Audit log</span></Link>
      <Link className={`nav-link automation-link${pathname.startsWith("/dashboard/automations") ? " active" : ""}`} href="/dashboard/automations" aria-current={pathname.startsWith("/dashboard/automations") ? "page" : undefined}><Workflow size={18} aria-hidden="true" /><span>Automations</span></Link>
      <span className="nav-section">Administration</span>
      <Link className={`nav-link administration-link${pathname.startsWith("/dashboard/data-governance") ? " active" : ""}`} href="/dashboard/data-governance" aria-current={pathname.startsWith("/dashboard/data-governance") ? "page" : undefined}><Archive size={18} aria-hidden="true" /><span>Data governance</span></Link>
      <Link className={`nav-link administration-link${pathname.startsWith("/dashboard/monitoring") ? " active" : ""}`} href="/dashboard/monitoring" aria-current={pathname.startsWith("/dashboard/monitoring") ? "page" : undefined}><Activity size={18} aria-hidden="true" /><span>Monitoring</span></Link>
    </nav>
  );
}
