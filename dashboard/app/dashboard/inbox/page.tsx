import type { Metadata } from "next";
import Link from "next/link";
import { Inbox } from "lucide-react";
import { requireMembership } from "../../../lib/auth";
import { createSupabaseServerClient } from "../../../lib/supabase-server";
import { formatWhen, getReplies } from "../../../lib/dashboard-data";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Replies" };

export default async function InboxPage() {
  const { membership } = await requireMembership();
  if (!membership) return null;
  const supabase = await createSupabaseServerClient();
  if (!supabase) throw new Error("Dashboard authentication is not configured.");
  const replies = await getReplies(supabase);
  return (
    <main className="dashboard-main" id="main-content">
      <header className="page-header"><div><p className="eyebrow">Email activity</p><h1>Replies</h1><p className="page-summary">Incoming prospect replies in one read-only queue.</p></div><span className="record-count">{replies.length} recent</span></header>
      {replies.length ? <section className="reply-list" aria-label="Recent replies">{replies.map(reply => <article className="reply-card" key={reply.id}><div className="reply-meta"><span className="avatar" aria-hidden="true">{reply.sender.charAt(0).toUpperCase()}</span><div><strong>{reply.sender}</strong><small>{reply.email} · {reply.company}</small></div><time dateTime={reply.receivedAt}>{formatWhen(reply.receivedAt)}</time></div><h2>{reply.subject}</h2><p>{reply.preview}</p>{reply.prospectId ? <Link className="panel-link" href={`/dashboard/crm/prospect/${reply.prospectId}`}>Open contact</Link> : null}</article>)}</section> : <div className="empty-state large-empty"><Inbox size={28} aria-hidden="true" /><strong>No replies received</strong><p>New prospect responses will appear here automatically.</p></div>}
    </main>
  );
}
