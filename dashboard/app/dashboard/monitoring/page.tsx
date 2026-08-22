import type { Metadata } from "next";
import { AlertTriangle, CheckCircle2, MonitorCog, ShieldCheck } from "lucide-react";
import { ApplicationErrorControl } from "../../components/application-error-control";
import { requireMembership } from "../../../lib/auth";
import { createSupabaseServerClient } from "../../../lib/supabase-server";
import { formatWhen } from "../../../lib/dashboard-data";
export const dynamic = "force-dynamic"; export const metadata: Metadata = { title: "Production monitoring" };
type ErrorEvent = { id: string; source: string; error_code: string; severity: "warning" | "critical"; occurrence_count: number; first_seen_at: string; last_seen_at: string };
const sourceLabels: Record<string, string> = { dashboard: "Dashboard rendering", outreach_cron: "Outreach scheduler", payment_recovery_cron: "Payment recovery scheduler", stripe_webhook: "Stripe webhook" };
export default async function MonitoringPage() {
  const { membership } = await requireMembership(); if (!membership) return null;
  const supabase = await createSupabaseServerClient();
  const readiness = supabase ? await supabase.rpc("dashboard_application_monitoring_ready") : { error: new Error("Unavailable") };
  const result = !readiness.error && supabase ? await supabase.from("application_error_events").select("id,source,error_code,severity,occurrence_count,first_seen_at,last_seen_at").eq("organization_id", membership.organization.id).is("acknowledged_at", null).order("last_seen_at", { ascending: false }).limit(100) : { data: [], error: readiness.error };
  const events = (result.data ?? []) as ErrorEvent[]; const openOccurrences = events.reduce((sum, event) => sum + Number(event.occurrence_count), 0);
  return <main className="dashboard-main" id="main-content">
    <header className="page-header"><div><p className="eyebrow">Production health</p><h1>Error monitoring</h1><p className="page-summary">Sanitized, deduplicated application failures from dashboard rendering, scheduled workers, and Stripe ingestion.</p></div><span className="record-count">{events.length} open</span></header>
    {result.error ? <section className="panel setup-panel"><MonitorCog size={20} aria-hidden="true" /><div><strong>Production monitoring is ready to install</strong><p>Apply migration 023 to capture sanitized production failures.</p></div></section> : <>
      <section className="monitoring-summary" aria-label="Monitoring summary"><article><AlertTriangle size={18} aria-hidden="true" /><span>Open issues</span><strong>{events.length}</strong></article><article><MonitorCog size={18} aria-hidden="true" /><span>Open occurrences</span><strong>{openOccurrences}</strong></article><article><ShieldCheck size={18} aria-hidden="true" /><span>Payload policy</span><strong>Codes only</strong></article></section>
      {events.length ? <section className="application-error-list" aria-label="Open production errors">{events.map(event => <article className={`application-error-item severity-${event.severity}`} key={event.id}><span className="application-error-icon"><AlertTriangle size={18} aria-hidden="true" /></span><div><div className="application-error-title"><span className={`status-badge alert-${event.severity}`}>{event.severity}</span><h2>{sourceLabels[event.source] ?? "Application service"}</h2></div><p>A sanitized production failure requires review. Inspect the matching Vercel log window for diagnostic detail.</p><small><code>{event.error_code}</code> · {event.occurrence_count.toLocaleString()} occurrence(s) · first {formatWhen(event.first_seen_at)} · latest {formatWhen(event.last_seen_at)}</small></div><ApplicationErrorControl eventId={event.id} /></article>)}</section> : <section className="monitoring-clear"><CheckCircle2 size={25} aria-hidden="true" /><div><strong>No open production errors</strong><p>New failures will appear here automatically. Acknowledged issues reopen if they recur.</p></div></section>}
    </>}
  </main>;
}
