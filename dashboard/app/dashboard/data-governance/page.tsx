import type { Metadata } from "next";
import { ArchiveRestore, Download, FileWarning, ShieldCheck } from "lucide-react";
import { requireMembership } from "../../../lib/auth";
import { createSupabaseServerClient } from "../../../lib/supabase-server";
import { RetentionPolicyControl } from "../../components/retention-policy-control";
export const dynamic = "force-dynamic"; export const metadata: Metadata = { title: "Data governance" };
const labels: Record<string, { name: string; description: string }> = {
  automation_history: { name: "Automation history", description: "Completed workflow runs and step execution records." }, worker_monitoring: { name: "Worker monitoring", description: "Outreach cycle heartbeats and sanitized failure state." }, email_content: { name: "Email content", description: "Inbound prospect replies and operator-prepared reply records." }, crm_notes: { name: "CRM notes", description: "Internal notes attached to prospect and customer records." }, audit_history: { name: "Audit history", description: "Sensitive action history; minimum retention is one year." },
};
type Preview = { category: string; retention_days: number; enabled: boolean; eligible_rows: number };
export default async function DataGovernancePage() {
  const { membership } = await requireMembership(); if (!membership) return null;
  if (membership.role !== "admin") return <main className="dashboard-main" id="main-content"><header className="page-header"><div><p className="eyebrow">Administrator only</p><h1>Data governance</h1><p className="page-summary">Only organization administrators can export data or configure retention periods.</p></div></header></main>;
  const supabase = await createSupabaseServerClient(); const { data, error } = supabase ? await supabase.rpc("dashboard_retention_preview", { target_organization_id: membership.organization.id }) : { data: null, error: new Error("Unavailable") }; const previews = (data ?? []) as Preview[];
  return <main className="dashboard-main" id="main-content">
    <header className="page-header"><div><p className="eyebrow">Security and lifecycle</p><h1>Data governance</h1><p className="page-summary">Export organization records and review what future retention rules would affect.</p></div><span className="record-count">Admin · MFA protected</span></header>
    <section className="data-export-panel"><span className="data-governance-icon"><Download size={21} aria-hidden="true" /></span><div><h2>Organization data export</h2><p>Download a versioned JSON bundle of CRM identities, notes, tasks, recovery cases, and sanitized audit history. Each dataset is capped at 5,000 rows and reports truncation explicitly.</p><small>The download contains sensitive client data. Store it encrypted and delete local copies when no longer required.</small></div><a className="primary-button data-export-button" href="/api/data-export">Download JSON export</a></section>
    <section className="retention-heading"><div><p className="eyebrow">Draft policies</p><h2>Retention previews</h2><p>These periods calculate eligible records only. Automated deletion remains disabled until a separately reviewed purge worker and backup validation are complete.</p></div><span><ShieldCheck size={16} aria-hidden="true" />No deletion enabled</span></section>
    {error ? <div className="setup-inline data-governance-setup"><FileWarning size={18} aria-hidden="true" />Run migration 022 to configure retention previews.</div> : <section className="retention-list" aria-label="Retention policy previews">{previews.map(policy => { const copy = labels[policy.category] ?? { name: policy.category, description: "Organization records." }; return <article className="retention-row" key={policy.category}><span className="data-governance-icon"><ArchiveRestore size={19} aria-hidden="true" /></span><div><h3>{copy.name}</h3><p>{copy.description}</p><small>{Number(policy.eligible_rows).toLocaleString()} record(s) currently older than this period</small></div><RetentionPolicyControl category={policy.category} days={policy.retention_days} minimum={policy.category === "audit_history" ? 365 : 30} /></article>; })}</section>}
  </main>;
}
