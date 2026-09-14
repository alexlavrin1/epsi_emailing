import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, CheckCheck, FileClock, MessageSquareText, RefreshCcw, Workflow } from "lucide-react";
import { ApprovalInbox } from "../../components/approval-inbox";
import { RecoveryRetryControl } from "../../components/approval-controls";
import { requireMembership } from "../../../lib/auth";
import { createSupabaseServerClient } from "../../../lib/supabase-server";
import { formatWhen, getApprovalData, type ApprovalData } from "../../../lib/dashboard-data";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Approvals" };
type ClientDraft = ApprovalData["clientDrafts"][number];
function draftIsSent(draft: ClientDraft) {
  return (draft.channel === "email" && draft.status === "approved" ? draft.deliveryStatus : draft.status) === "sent";
}

export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<{ drafts?: string }> }) {
  const { membership } = await requireMembership();
  if (!membership) return null;
  const supabase = await createSupabaseServerClient();
  if (!supabase) throw new Error("Dashboard authentication is not configured.");
  const data = await getApprovalData(supabase, membership.organization.id);
  const params = await searchParams;
  const draftsFilter: "all" | "sent" | "unsent" = params.drafts === "sent" ? "sent" : params.drafts === "unsent" ? "unsent" : "all";
  const clientDrafts = draftsFilter === "all" ? data.clientDrafts : data.clientDrafts.filter(draft => draftIsSent(draft) === (draftsFilter === "sent"));
  const replyDrafts = draftsFilter === "all" ? data.replies : data.replies.filter(reply => (reply.status === "sent") === (draftsFilter === "sent"));
  const pendingClientConversations = new Set(data.clientDrafts.filter(draft => draft.status === "draft").map(draft => `${draft.appId}:${draft.contactId}:${draft.playbookId}`)).size;
  const pendingReplyConversations = new Set(data.replies.filter(reply => ["draft", "failed"].includes(reply.status)).map(reply => `${reply.prospectId || reply.email}:${reply.campaignId || reply.campaignName}`)).size;
  const pending = pendingClientConversations + pendingReplyConversations + data.retries.length;
  return <main className="dashboard-main" id="main-content">
    <header className="page-header"><div><p className="eyebrow">Human checkpoint</p><h1>Approvals</h1><p className="page-summary">Review message content and failed deliveries before anything is queued for external execution.</p></div><div className="page-header-actions"><span className="record-count">{pending} awaiting decision</span><Link className="secondary-button compact-button header-action" href="/dashboard/automations"><Workflow size={15} aria-hidden="true" />Automations</Link><Link className="secondary-button compact-button header-action" href="/dashboard/audit"><FileClock size={15} aria-hidden="true" />Audit log</Link></div></header>
    {!data.ready ? <section className="panel setup-panel"><CheckCheck size={20} aria-hidden="true" /><div><strong>Approval controls are ready to install</strong><p>Apply migration 009 to enable reply drafts and controlled recovery retries.</p></div></section> : null}
    {!data.clientDraftsReady ? <section className="panel setup-panel"><MessageSquareText size={20} aria-hidden="true" /><div><strong>Client email delivery is ready to install</strong><p>Apply migration 042 to queue approved emails and show delivery status.</p></div></section> : null}

    <section className="approval-section" aria-labelledby="approval-inbox-heading"><div className="section-heading"><div><p className="eyebrow">Conversations</p><h2 id="approval-inbox-heading">Approval inbox</h2></div><nav className="performance-range draft-filter" aria-label="Filter approvals by delivery"><Link href="/dashboard/approvals" aria-current={draftsFilter === "all" ? "page" : undefined}>All</Link><Link href="/dashboard/approvals?drafts=sent" aria-current={draftsFilter === "sent" ? "page" : undefined}>Sent</Link><Link href="/dashboard/approvals?drafts=unsent" aria-current={draftsFilter === "unsent" ? "page" : undefined}>Not sent</Link></nav></div>
      <ApprovalInbox clientDrafts={clientDrafts} replies={replyDrafts} />
    </section>

    <section className="approval-section" id="recovery-retries" aria-labelledby="recovery-retries-heading"><div className="section-heading"><div><p className="eyebrow">Recovery delivery</p><h2 id="recovery-retries-heading">Failed message retries</h2></div><span className="count-badge">{data.retries.length}</span></div>
      {data.retries.length ? <div className="approval-list">{data.retries.map(item => <article className="approval-card retry-card" key={item.id}><div className="approval-card-head"><span className="activity-icon payment"><RefreshCcw size={16} aria-hidden="true" /></span><div><strong>{item.customer}</strong><small>{item.channel} delivery · {item.attempts} attempts</small></div><span className="status-badge status-failed">failed</span></div><p className="approval-error"><AlertTriangle size={14} aria-hidden="true" />{item.error}</p><footer><time dateTime={item.updatedAt}>Failed {formatWhen(item.updatedAt)}</time><RecoveryRetryControl id={item.id} customer={item.customer} channel={item.channel} /></footer></article>)}</div> : <div className="empty-state approval-empty"><RefreshCcw size={22} aria-hidden="true" /><strong>No failed deliveries</strong><p>Failed email or Slack recovery messages will appear here for controlled retry.</p></div>}
    </section>
  </main>;
}
