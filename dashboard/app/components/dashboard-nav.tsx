"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Building2, Columns3, Inbox, LayoutDashboard, Megaphone, Users, Workflow } from "lucide-react";

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
      <Link className={`nav-link automation-link${pathname.startsWith("/dashboard/campaigns") ? " active" : ""}`} href="/dashboard/campaigns" aria-current={pathname.startsWith("/dashboard/campaigns") ? "page" : undefined}><Megaphone size={18} aria-hidden="true" /><span>Campaigns</span></Link>
      <span className="nav-link disabled" aria-disabled="true"><Workflow size={18} aria-hidden="true" /><span>Automations</span></span>
    </nav>
  );
}
