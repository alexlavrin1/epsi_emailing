import type { Metadata } from "next";
import Link from "next/link";
import { CheckCheck, Inbox } from "lucide-react";
import { ReplyDraftForm } from "../../components/reply-draft-form";
import { requireMembership } from "../../../lib/auth";
import { createSupabaseServerClient } from "../../../lib/supabase-server";
import { formatWhen, getReplies, getReplyControlsReady } from "../../../lib/dashboard-data";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Replies" };

export default async function InboxPage() {
  const { membership } = await requireMembership();
  if (!membership) return null;
  const supabase = await createSupabaseServerClient();
  if (!supabase) throw new Error("Dashboard authentication is not configured.");
  const [replies, controlsReady] = await Promise.all([getReplies(supabase), getReplyControlsReady(supabase)]);
  return (
    <main className="dashboard-main" id="main-content">
      <header className="page-header"><div><p className="eyebrow">Email activity</p><h1>Replies</h1><p className="page-summary">Incoming prospect replies with approval-gated response drafting.</p></div><div className="page-header-actions"><span className="record-count">{replies.length} recent</span><Link className="secondary-button compact-button header-action" href="/dashboard/approvals"><CheckCheck size={15} aria-hidden="true" />Review approvals</Link></div></header>
      {replies.length ? <section className="reply-list" aria-label="Recent replies">{replies.map(reply => <article className="reply-card" key={reply.id}><div className="reply-meta"><span className="avatar" aria-hidden="true">{reply.sender.charAt(0).toUpperCase()}</span><div><strong>{reply.sender}</strong><small>{reply.email} · {reply.company}</small></div><time dateTime={reply.receivedAt}>{formatWhen(reply.receivedAt)}</time></div><h2>{reply.subject}</h2><p>{reply.preview}</p><div className="reply-actions">{reply.prospectId ? <Link className="panel-link" href={`/dashboard/crm/prospect/${reply.prospectId}`}>Open contact</Link> : null}<ReplyDraftForm replyId={reply.id} recipient={reply.sender} ready={controlsReady} /></div></article>)}</section> : <div className="empty-state large-empty"><Inbox size={28} aria-hidden="true" /><strong>No replies received</strong><p>New prospect responses will appear here automatically.</p></div>}
    </main>
  );
}
