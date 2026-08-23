import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, CheckCheck, FileClock, Mail, MailCheck, MessageSquareText, RefreshCcw, Workflow } from "lucide-react";
import { ClientPlaybookDraftControl, RecoveryRetryControl, ReplyApprovalControl } from "../../components/approval-controls";
import { requireMembership } from "../../../lib/auth";
import { createSupabaseServerClient } from "../../../lib/supabase-server";
import { formatWhen, getApprovalData } from "../../../lib/dashboard-data";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Approvals" };

export default async function ApprovalsPage() {
  const { membership } = await requireMembership();
  if (!membership) return null;
  const supabase = await createSupabaseServerClient();
  if (!supabase) throw new Error("Dashboard authentication is not configured.");
  const data = await getApprovalData(supabase, membership.organization.id);
  const pending = data.replies.filter(reply => ["draft", "failed"].includes(reply.status)).length + data.retries.length + data.clientDrafts.filter(draft => draft.status === "draft").length;
  return <main className="dashboard-main" id="main-content">
    <header className="page-header"><div><p className="eyebrow">Human checkpoint</p><h1>Approvals</h1><p className="page-summary">Review message content and failed deliveries before anything is queued for external execution.</p></div><div className="page-header-actions"><span className="record-count">{pending} awaiting decision</span><Link className="secondary-button compact-button header-action" href="/dashboard/automations"><Workflow size={15} aria-hidden="true" />Automations</Link><Link className="secondary-button compact-button header-action" href="/dashboard/audit"><FileClock size={15} aria-hidden="true" />Audit log</Link></div></header>
    {!data.ready ? <section className="panel setup-panel"><CheckCheck size={20} aria-hidden="true" /><div><strong>Approval controls are ready to install</strong><p>Apply migration 009 to enable reply drafts and controlled recovery retries.</p></div></section> : null}
    {!data.clientDraftsReady ? <section className="panel setup-panel"><MessageSquareText size={20} aria-hidden="true" /><div><strong>Client playbook approvals are ready to install</strong><p>Apply migration 032 to review scheduled client-success drafts.</p></div></section> : null}

    <section className="approval-section" aria-labelledby="client-draft-approvals-heading"><div className="section-heading"><div><p className="eyebrow">Client success</p><h2 id="client-draft-approvals-heading">Playbook drafts</h2></div><span className="count-badge">{data.clientDrafts.length}</span></div>
      {data.clientDrafts.length ? <div className="approval-list">{data.clientDrafts.map(draft => <article className="approval-card client-playbook-draft-card" key={draft.id}><div className="approval-card-head"><span className="activity-icon">{draft.channel === "email" ? <Mail size={16} aria-hidden="true" /> : <MessageSquareText size={16} aria-hidden="true" />}</span><div><strong>{draft.contactName} · {draft.appName}</strong><small>{draft.channel} · {draft.recipient}</small><small className="automation-source"><Workflow size={12} aria-hidden="true" />{draft.playbookName} · v{draft.playbookVersion} · {draft.generationMode}</small><small>{draft.contextMessageCount} stored email messages available as context</small></div><span className={`status-badge status-${draft.status}`}>{draft.status}</span></div>{draft.subject ? <h3 className="client-draft-subject">{draft.subject}</h3> : null}<div className="approval-preview">{draft.body}</div><footer><time dateTime={draft.createdAt}>Created {formatWhen(draft.createdAt)}</time>{draft.status === "draft" ? <ClientPlaybookDraftControl id={draft.id} channel={draft.channel} subject={draft.subject} body={draft.body} contact={draft.contactName} /> : <Link className="secondary-button compact-button" href={`/dashboard/clients/${draft.appId}`}>Open client</Link>}</footer></article>)}</div> : <div className="empty-state approval-empty"><MessageSquareText size={22} aria-hidden="true" /><strong>No client playbook drafts</strong><p>Prepare one from an eligible client page. No playbook can send from this slice.</p></div>}
    </section>

    <section className="approval-section" aria-labelledby="reply-approvals-heading"><div className="section-heading"><div><p className="eyebrow">Email replies</p><h2 id="reply-approvals-heading">Draft review</h2></div><span className="count-badge">{data.replies.length}</span></div>
      {data.replies.length ? <div className="approval-list">{data.replies.map(reply => <article className="approval-card" key={reply.id}><div className="approval-card-head"><span className="activity-icon"><MailCheck size={16} aria-hidden="true" /></span><div><strong>{reply.contact}</strong><small>{reply.email} · {reply.subject}</small>{reply.automationName ? <small className="automation-source"><Workflow size={12} aria-hidden="true" />Prepared by {reply.automationName}</small> : null}</div><span className={`status-badge status-${reply.status}`}>{reply.status}</span></div><div className="approval-preview">{reply.body}</div>{reply.lastError ? <p className="approval-error"><AlertTriangle size={14} aria-hidden="true" />{reply.lastError}</p> : null}<footer><time dateTime={reply.createdAt}>Created {formatWhen(reply.createdAt)}</time><ReplyApprovalControl id={reply.id} status={reply.status} contact={reply.contact} body={reply.body} /></footer></article>)}</div> : <div className="empty-state approval-empty"><MailCheck size={22} aria-hidden="true" /><strong>No reply drafts</strong><p>Create a draft from the Replies inbox. Drafts never send without approval.</p></div>}
    </section>

    <section className="approval-section" id="recovery-retries" aria-labelledby="recovery-retries-heading"><div className="section-heading"><div><p className="eyebrow">Recovery delivery</p><h2 id="recovery-retries-heading">Failed message retries</h2></div><span className="count-badge">{data.retries.length}</span></div>
      {data.retries.length ? <div className="approval-list">{data.retries.map(item => <article className="approval-card retry-card" key={item.id}><div className="approval-card-head"><span className="activity-icon payment"><RefreshCcw size={16} aria-hidden="true" /></span><div><strong>{item.customer}</strong><small>{item.channel} delivery · {item.attempts} attempts</small></div><span className="status-badge status-failed">failed</span></div><p className="approval-error"><AlertTriangle size={14} aria-hidden="true" />{item.error}</p><footer><time dateTime={item.updatedAt}>Failed {formatWhen(item.updatedAt)}</time><RecoveryRetryControl id={item.id} customer={item.customer} channel={item.channel} /></footer></article>)}</div> : <div className="empty-state approval-empty"><RefreshCcw size={22} aria-hidden="true" /><strong>No failed deliveries</strong><p>Failed email or Slack recovery messages will appear here for controlled retry.</p></div>}
    </section>
  </main>;
}
