import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowUpRight, Clock3, Globe2, Mail, MessageSquareText, UserRound, Users } from "lucide-react";
import { requireMembership } from "../../../../lib/auth";
import { createSupabaseServerClient } from "../../../../lib/supabase-server";
import { formatWhen } from "../../../../lib/dashboard-data";
import { getClientAppDetail } from "../../../../lib/client-data";
import { ClientContactForm, ClientSlackAssignment, ClientSlackConnectLink } from "../../../components/client-forms";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const metadata: Metadata = { title: "Client workspace" };

export default async function ClientAppPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; const { membership } = await requireMembership();
  if (!membership) return null;
  const supabase = await createSupabaseServerClient();
  const data = supabase ? await getClientAppDetail(supabase, membership.organization.id, id) : { ready: false, app: null, messages: [] };
  if (data.ready && !data.app) notFound();
  if (!data.app) return <main className="dashboard-main" id="main-content"><section className="panel setup-panel"><Users size={20} aria-hidden="true" /><div><strong>Client data is unavailable</strong><p>Apply migration 025, then refresh this page.</p></div></section></main>;
  const app = data.app; const contactsById = new Map(app.contacts.map(contact => [contact.id, contact]));
  const threadMap = new Map<string, typeof data.messages>();
  for (const message of data.messages) threadMap.set(message.threadKey, [...(threadMap.get(message.threadKey) || []), message]);
  const threads = [...threadMap.entries()].map(([key, messages]) => ({ key, messages, latest: messages[0] }));
  return <main className="dashboard-main" id="main-content">
    <Link className="back-row" href="/dashboard/clients"><ArrowLeft size={15} aria-hidden="true" />All clients</Link>
    <header className="client-detail-header"><span className="client-detail-icon"><Globe2 size={24} aria-hidden="true" /></span><div><p className="eyebrow">Existing client</p><h1>{app.name}</h1><a href={app.websiteUrl} target="_blank" rel="noreferrer">{app.websiteUrl}<ArrowUpRight size={14} aria-hidden="true" /></a></div><span className="status-badge status-active">{app.status}</span></header>
    <div className="client-detail-layout">
      <section className="client-main-column" aria-labelledby="correspondence-heading"><div className="section-heading"><div><p className="eyebrow">Yandex IMAP</p><h2 id="correspondence-heading">Email correspondence</h2></div><span className="count-badge">{threads.length} thread{threads.length === 1 ? "" : "s"}</span></div>
        {threads.length ? <div className="client-thread-list">{threads.map((thread, index) => { const participants = [...new Set(thread.messages.map(message => contactsById.get(message.clientContactId)?.name).filter(Boolean))]; const title = (thread.latest.subject || "No subject").replace(/^(\s*(?:re|fw|fwd)(?:\[[0-9]+\])?:\s*)+/i, "") || "No subject"; return <details className="client-thread" key={thread.key} open={index === 0}><summary className="client-thread-summary"><span className="client-thread-icon"><MessageSquareText size={17} aria-hidden="true" /></span><span className="client-thread-heading"><strong>{title}</strong><small>{participants.join(", ") || "Client"} · {thread.messages.length} message{thread.messages.length === 1 ? "" : "s"}</small></span><time dateTime={thread.latest.occurredAt}>{formatWhen(thread.latest.occurredAt)}</time></summary><ol className="client-message-list">{[...thread.messages].reverse().map(message => { const contact = contactsById.get(message.clientContactId); return <li key={message.id}><span className={`client-message-icon ${message.direction}`}><Mail size={15} aria-hidden="true" /></span><article><header><div><strong>{message.direction === "inbound" ? contact?.name || "Client" : "EpsiFlow"}</strong><span className={`status-badge status-${message.direction === "inbound" ? "replied" : "sent"}`}>{message.direction}</span></div><time dateTime={message.occurredAt}>{formatWhen(message.occurredAt)}</time></header><h3>{message.subject || "No subject"}</h3>{message.body ? <details><summary>Read message</summary><p>{message.body}</p></details> : <p className="muted">No plain-text body was available.</p>}</article></li>; })}</ol></details>; })}</div> : <div className="empty-state client-correspondence-empty"><Mail size={24} aria-hidden="true" /><strong>No matched correspondence yet</strong><p>The engine checks INBOX and Sent for these contact emails on each outreach cycle.</p></div>}
      </section>
      <aside className="client-side-column" aria-label="Client contacts"><section className="panel"><div className="panel-heading"><div><p className="eyebrow">People</p><h2>Contacts</h2></div><Users size={18} aria-hidden="true" /></div><div className="client-contact-list">{app.contacts.map(contact => { const assignedUrl = contact.slackStatus === "assigned" && contact.slackTeamId && contact.slackChannelId ? `https://app.slack.com/client/${encodeURIComponent(contact.slackTeamId)}/${encodeURIComponent(contact.slackChannelId)}` : null; const slackUrl = contact.slackStatus === "linked" ? contact.slackChatUrl : assignedUrl; return <article className="client-contact-card" key={contact.id}><header><span><UserRound size={17} aria-hidden="true" /></span><div><strong>{contact.name}</strong><a href={`mailto:${contact.email}`}>{contact.email}</a></div></header><div className="client-contact-sync"><Clock3 size={13} aria-hidden="true" /><span>{contact.lastEmailSyncAt ? `Mailbox checked ${formatWhen(contact.lastEmailSyncAt)}` : "Mailbox match pending"}</span></div>{slackUrl ? <a className="client-slack-link" href={slackUrl} target="_blank" rel="noreferrer"><MessageSquareText size={15} aria-hidden="true" />Open {contact.slackChatLabel || contact.slackDisplayName || contact.slackName || "Slack chat"}<ArrowUpRight size={14} aria-hidden="true" /></a> : <><span className={`client-slack-status status-${contact.slackStatus}`}><MessageSquareText size={14} aria-hidden="true" />{contact.slackStatus === "pending" ? "Slack assignment pending" : contact.slackStatus === "failed" ? `Assignment failed · ${contact.slackFailureCode || "retry available"}` : "No Slack chat assigned"}</span>{contact.slackStatus !== "pending" ? <ClientSlackAssignment clientAppId={app.id} contactId={contact.id} slackName={contact.slackName} status={contact.slackStatus} /> : null}<ClientSlackConnectLink clientAppId={app.id} contactId={contact.id} /></>}</article>; })}</div></section>
        <details className="panel client-add-contact"><summary>Add another contact</summary><ClientContactForm clientAppId={app.id} /></details>
      </aside>
    </div>
  </main>;
}
