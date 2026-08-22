import type { Metadata } from "next";
import Link from "next/link";
import { Activity, AlertTriangle, ArrowRight, CheckCheck, CircleStop, Clock3, GitBranch, History, MailCheck, PauseCircle, PlayCircle, ShieldCheck, Workflow } from "lucide-react";
import { AutomationRuntimeControl } from "../../components/automation-runtime-control";
import { WorkflowBuilder, WorkflowControls } from "../../components/workflow-controls";
import { requireMembership } from "../../../lib/auth";
import { createSupabaseServerClient } from "../../../lib/supabase-server";
import { formatWhen, getAutomationData } from "../../../lib/dashboard-data";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Automations" };

function delayLabel(minutes: number) {
  if (!minutes) return "Immediately";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  if (minutes % 1440 === 0) return `${minutes / 1440} day${minutes === 1440 ? "" : "s"}`;
  if (minutes % 60 === 0) return `${minutes / 60} hour${minutes === 60 ? "" : "s"}`;
  return `${minutes} minutes`;
}

export default async function AutomationsPage() {
  const { membership } = await requireMembership();
  if (!membership) return null;
  const supabase = await createSupabaseServerClient();
  if (!supabase) throw new Error("Dashboard authentication is not configured.");
  const data = await getAutomationData(supabase, membership.organization.id);
  const isAdmin = membership.role === "admin";
  return <main className="dashboard-main" id="main-content">
    <header className="page-header"><div><p className="eyebrow">Structured workflows</p><h1>Automations</h1><p className="page-summary">Prepare repeatable work while keeping every external reply behind a human checkpoint.</p></div><div className="page-header-actions"><span className="record-count">{data.workflows.length} workflows</span><Link className="secondary-button compact-button header-action" href="/dashboard/approvals"><CheckCheck size={15} aria-hidden="true" />Review approvals</Link></div></header>
    {!data.ready ? <section className="panel setup-panel"><Workflow size={20} aria-hidden="true" /><div><strong>Automation controls are ready to install</strong><p>Apply migration 011 to enable versioned reply-draft workflows and run history.</p></div></section> : null}
    {data.ready && !data.runtime.ready ? <section className="panel setup-panel"><ShieldCheck size={20} aria-hidden="true" /><div><strong>Global runtime controls are ready to install</strong><p>Apply migration 014 to enable the emergency pause and runtime health status.</p></div></section> : null}
    {data.ready && !data.worker.ready ? <section className="panel setup-panel"><Activity size={20} aria-hidden="true" /><div><strong>Worker heartbeat monitoring is ready to install</strong><p>Apply migration 015 to record scheduled worker cycles and failures.</p></div></section> : null}

    {data.runtime.ready ? <section className={`automation-runtime ${data.runtime.paused ? "paused" : "running"}`} aria-labelledby="runtime-heading"><div className="runtime-status-icon" aria-hidden="true">{data.runtime.paused ? <AlertTriangle size={22} /> : <ShieldCheck size={22} />}</div><div className="runtime-copy"><p className="eyebrow">Runtime status</p><h2 id="runtime-heading">{data.runtime.paused ? "All automations paused" : "Automation runtime enabled"}</h2><p>{data.runtime.paused ? data.runtime.reason : "New triggers and queued work can be claimed by active workflows."}</p><small>{data.runtime.pausedAt ? `Paused ${formatWhen(data.runtime.pausedAt)}` : data.runtime.updatedAt ? `Control updated ${formatWhen(data.runtime.updatedAt)}` : "Runtime control active"} · manual replies are unaffected</small></div><AutomationRuntimeControl paused={data.runtime.paused} isAdmin={isAdmin} /></section> : null}

    {data.worker.ready ? <section className={`automation-worker-health state-${data.worker.state}`} aria-labelledby="worker-health-heading"><header><div><p className="eyebrow">Worker heartbeat</p><h2 id="worker-health-heading">Outreach cycle</h2></div><span className={`status-badge status-${data.worker.state === "healthy" ? "active" : data.worker.state === "failed" ? "failed" : data.worker.state}`}>{data.worker.state}</span></header><div className="worker-health-grid"><span><small>Latest cycle</small><strong>{data.worker.latestStartedAt ? formatWhen(data.worker.latestStartedAt) : "No heartbeat yet"}</strong></span><span><small>Last success</small><strong>{data.worker.lastSuccessAt ? formatWhen(data.worker.lastSuccessAt) : "Not recorded"}</strong></span><span><small>Failures · 24h</small><strong>{data.worker.recentFailures}</strong></span></div>{data.worker.latestFailureCode ? <p className="worker-failure"><AlertTriangle size={14} aria-hidden="true" />Latest failure code: <code>{data.worker.latestFailureCode}</code></p> : null}<p className="worker-health-note">A heartbeat older than 30 minutes is marked stale. Weekends may be stale because the outreach cron is scheduled for weekdays.</p></section> : null}

    <section className="automation-metrics" aria-label="Automation summary">
      <article><PlayCircle size={17} aria-hidden="true" /><span>Active workflows</span><strong>{data.metrics.active}</strong></article>
      <article><CheckCheck size={17} aria-hidden="true" /><span>Waiting approval</span><strong>{data.metrics.waitingApproval}</strong></article>
      <article><ShieldCheck size={17} aria-hidden="true" /><span>Succeeded</span><strong>{data.metrics.succeeded}</strong></article>
      <article><CircleStop size={17} aria-hidden="true" /><span>Failed</span><strong>{data.metrics.failed}</strong></article>
    </section>

    <section className="automation-section" aria-labelledby="workflow-definitions-heading"><div className="section-heading"><div><p className="eyebrow">Definitions</p><h2 id="workflow-definitions-heading">Reply workflows</h2></div><span className="count-badge">{data.workflows.length}</span></div>
      {data.workflows.length ? <div className="workflow-list">{data.workflows.map(workflow => <article className="workflow-card" key={workflow.id}><header><span className={`workflow-state-icon ${workflow.status}`} aria-hidden="true">{workflow.status === "active" ? <PlayCircle size={19} /> : <PauseCircle size={19} />}</span><div><span className={`status-badge status-${workflow.status}`}>{workflow.status}</span><h3>{workflow.name}</h3><p>{workflow.description || "No description"}</p></div><div className="workflow-version"><span>Version</span><strong>v{workflow.currentVersion}</strong><small>{workflow.versions} immutable snapshot{workflow.versions === 1 ? "" : "s"}</small></div></header>
        <div className="workflow-path" aria-label="Workflow sequence"><span><MailCheck size={15} aria-hidden="true" /><small>Trigger</small><strong>Reply received</strong></span><ArrowRight size={14} aria-hidden="true" /><span><GitBranch size={15} aria-hidden="true" /><small>Condition</small><strong>Prospect active</strong></span><ArrowRight size={14} aria-hidden="true" /><span><Clock3 size={15} aria-hidden="true" /><small>Delay</small><strong>{delayLabel(workflow.delayMinutes)}</strong></span><ArrowRight size={14} aria-hidden="true" /><span><CheckCheck size={15} aria-hidden="true" /><small>Action</small><strong>Draft + approval</strong></span></div>
        <footer><span>Updated {formatWhen(workflow.updatedAt)} · approval always required</span><WorkflowControls workflow={workflow} isAdmin={isAdmin} /></footer></article>)}</div> : <div className="empty-state automation-empty"><Workflow size={25} aria-hidden="true" /><strong>No workflow definitions yet</strong><p>Create a draft below. Nothing activates or sends until an administrator explicitly enables it.</p></div>}
    </section>

    <section className="automation-layout"><article className="panel workflow-builder-panel" id="new-workflow"><div className="panel-heading"><div><p className="eyebrow">New definition</p><h2>Incoming reply draft</h2></div><MailCheck size={18} aria-hidden="true" /></div><p className="workflow-builder-copy">When a new outreach reply arrives, prepare a versioned response draft. The operator can edit and approve it from the approval queue.</p><WorkflowBuilder isAdmin={isAdmin} /></article>
      <article className="panel automation-safety"><div className="panel-heading"><div><p className="eyebrow">Guardrails</p><h2>What this workflow cannot do</h2></div><ShieldCheck size={18} aria-hidden="true" /></div><ul><li><CircleStop size={15} aria-hidden="true" /><span><strong>No automatic sending</strong><small>Prepared replies remain inert until approved.</small></span></li><li><PauseCircle size={15} aria-hidden="true" /><span><strong>Pause is immediate</strong><small>Delayed runs claim work only while the definition is active.</small></span></li><li><GitBranch size={15} aria-hidden="true" /><span><strong>Stop conditions rechecked</strong><small>Inactive prospects and missing reply context fail closed.</small></span></li><li><History size={15} aria-hidden="true" /><span><strong>Runs stay version-pinned</strong><small>Editing creates a new immutable snapshot.</small></span></li></ul></article>
    </section>

    <section className="automation-section" aria-labelledby="run-history-heading"><div className="section-heading"><div><p className="eyebrow">Execution ledger</p><h2 id="run-history-heading">Recent run history</h2></div><span className="count-badge">{data.runs.length}</span></div>
      {data.runs.length ? <div className="table-shell automation-runs"><table className="data-table"><thead><tr><th>Workflow</th><th>Contact</th><th>Status</th><th>Version</th><th>Scheduled</th><th>Result</th></tr></thead><tbody>{data.runs.map(run => <tr key={run.id}><td><strong>{run.workflowName}</strong><small>Run {run.id.slice(0, 8)}</small></td><td><Link className="panel-link" href={`/dashboard/crm/prospect/${run.prospectId}`}>{run.contact}</Link></td><td><span className={`status-badge status-${run.status.replaceAll("_", "-")}`}>{run.status.replaceAll("_", " ")}</span></td><td>v{run.workflowVersion}</td><td>{formatWhen(run.scheduledFor)}</td><td>{run.lastError ? <span className="run-error">{run.lastError}</span> : run.replyStatus ? `Reply ${run.replyStatus}` : run.completedAt ? `Completed ${formatWhen(run.completedAt)}` : "In progress"}</td></tr>)}</tbody></table></div> : <div className="empty-state automation-empty"><History size={25} aria-hidden="true" /><strong>No automation runs yet</strong><p>Runs appear after an active workflow sees a new prospect reply.</p></div>}
    </section>
  </main>;
}
