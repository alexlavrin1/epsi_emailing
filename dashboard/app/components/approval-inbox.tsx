"use client";

import { useMemo, useState } from "react";
import { CheckCheck, ChevronRight, Mail, MessageSquareText, UserRound, Workflow, X } from "lucide-react";
import type { ApprovalConversationMessage, ApprovalData } from "../../lib/dashboard-data";
import { ClientPlaybookDraftControl, ReplyApprovalControl } from "./approval-controls";

type ClientDraft = ApprovalData["clientDrafts"][number];
type ReplyDraft = ApprovalData["replies"][number];
type InboxItem =
  | { key: string; kind: "playbook"; topic: string; contact: string; email: string; company: string; campaign: string; status: string; createdAt: string; drafts: ClientDraft[]; currentDraft: ClientDraft | null; conversation: ApprovalConversationMessage[] }
  | { key: string; kind: "reply"; topic: string; contact: string; email: string; company: string; campaign: string; status: string; createdAt: string; drafts: ReplyDraft[]; currentDraft: ReplyDraft | null; conversation: ApprovalConversationMessage[] };

function formatMessageTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "Unknown time";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}

function visibleClientStatus(draft: ClientDraft) {
  if (draft.status === "draft" && ["pending", "processing"].includes(draft.agentStatus)) return "generating";
  return draft.channel === "email" && draft.status === "approved" ? draft.deliveryStatus : draft.status;
}

function mergeMessages(messages: ApprovalConversationMessage[]) {
  const unique = new Map<string, ApprovalConversationMessage>();
  for (const message of messages) {
    const key = message.providerMessageId ? `provider:${message.providerMessageId}` : `record:${message.id}`;
    if (!unique.has(key)) unique.set(key, message);
  }
  return [...unique.values()].sort((a,b) => a.occurredAt.localeCompare(b.occurredAt));
}

function groupClientDrafts(drafts: ClientDraft[]): InboxItem[] {
  const groups = new Map<string, ClientDraft[]>();
  for (const draft of drafts) {
    const key = `playbook:${draft.appId}:${draft.contactId}:${draft.playbookId}`;
    groups.set(key, [...(groups.get(key) ?? []), draft]);
  }
  return [...groups.entries()].map(([key, unsorted]) => {
    const grouped = [...unsorted].sort((a,b) => b.createdAt.localeCompare(a.createdAt));
    const latest = grouped[0];
    const currentDraft = grouped.find(draft => !(draft.status === "approved" && draft.deliveryStatus === "sent") && !["cancelled", "skipped"].includes(draft.status)) ?? null;
    const sentMessages = grouped.flatMap(draft => draft.status === "approved" && draft.deliveryStatus === "sent" && draft.deliveredAt ? [{
      id: `playbook-sent-${draft.id}`, direction: "outbound" as const, subject: draft.subject || `${draft.channel} message`, body: draft.body, occurredAt: draft.deliveredAt, providerMessageId: draft.providerMessageId,
    }] : []);
    const conversation = mergeMessages([...(latest.conversation ?? []), ...sentMessages]);
    const statusDraft = currentDraft ?? latest;
    return { key, kind: "playbook" as const, topic: statusDraft.subject || `${statusDraft.channel} message`, contact: latest.contactName, email: latest.contactEmail, company: latest.appName, campaign: latest.playbookName, status: visibleClientStatus(statusDraft), createdAt: statusDraft.deliveredAt || statusDraft.createdAt, drafts: grouped, currentDraft, conversation };
  });
}

function groupReplyDrafts(drafts: ReplyDraft[]): InboxItem[] {
  const groups = new Map<string, ReplyDraft[]>();
  for (const draft of drafts) {
    const key = `reply:${draft.prospectId || draft.email}:${draft.campaignId || draft.campaignName}`;
    groups.set(key, [...(groups.get(key) ?? []), draft]);
  }
  return [...groups.entries()].map(([key, unsorted]) => {
    const grouped = [...unsorted].sort((a,b) => b.createdAt.localeCompare(a.createdAt));
    const latest = grouped[0];
    const currentDraft = grouped.find(draft => !["sent", "cancelled", "skipped"].includes(draft.status)) ?? null;
    const sentMessages = grouped.flatMap(draft => draft.status === "sent" && draft.sentAt ? [{
      id: `reply-sent-${draft.id}`, direction: "outbound" as const, subject: draft.subject, body: draft.body, occurredAt: draft.sentAt, providerMessageId: draft.providerMessageId,
    }] : []);
    const conversation = mergeMessages([...(latest.conversation ?? []), ...sentMessages]);
    const statusDraft = currentDraft ?? latest;
    return { key, kind: "reply" as const, topic: statusDraft.subject, contact: latest.contact, email: latest.email, company: latest.company, campaign: latest.campaignName, status: statusDraft.status, createdAt: statusDraft.sentAt || statusDraft.createdAt, drafts: grouped, currentDraft, conversation };
  });
}

function ConversationMessage({ message }: { message: ApprovalConversationMessage }) {
  return <article className={`approval-message approval-message-${message.direction}`}>
    <header><strong>{message.direction === "inbound" ? "Contact" : "EpsiFlow"}</strong><time dateTime={message.occurredAt}>{formatMessageTime(message.occurredAt)}</time></header>
    {message.subject && message.subject !== "No subject" ? <h4>{message.subject}</h4> : null}
    <p>{message.body}</p>
  </article>;
}

export function ApprovalInbox({ clientDrafts, replies }: { clientDrafts: ClientDraft[]; replies: ReplyDraft[] }) {
  const items = useMemo<InboxItem[]>(() => [...groupClientDrafts(clientDrafts), ...groupReplyDrafts(replies)].sort((a,b) => b.createdAt.localeCompare(a.createdAt)), [clientDrafts, replies]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const selected = items.find(item => item.key === selectedKey) ?? null;

  return <div className={`approval-inbox${selected ? " has-selection" : ""}`}>
    <section className="approval-inbox-list" aria-label="Approval conversations">
      <header className="approval-inbox-list-header"><strong>{items.length} conversation{items.length === 1 ? "" : "s"}</strong><small>One card per contact and campaign</small></header>
      {items.length ? items.map(item => <button className={`approval-inbox-row${selectedKey === item.key ? " is-selected" : ""}`} type="button" key={item.key} onClick={() => setSelectedKey(item.key)} aria-expanded={selectedKey === item.key} aria-controls="approval-conversation-panel">
        <span className="approval-inbox-avatar" aria-hidden="true"><UserRound size={17} /></span>
        <span className="approval-inbox-copy">
          <span className="approval-inbox-contact"><strong>{item.contact}</strong><time dateTime={item.createdAt}>{formatMessageTime(item.createdAt)}</time></span>
          <span className="approval-inbox-topic">{item.topic}</span>
          <span className="approval-inbox-campaign"><Workflow size={12} aria-hidden="true" />{item.campaign}</span>
          <span className="approval-inbox-meta">{item.company} · {item.email}{item.drafts.length > 1 ? ` · ${item.drafts.length} messages` : ""}</span>
        </span>
        <span className={`status-badge status-${item.status.replaceAll("_", "-")}`}>{item.status.replaceAll("_", " ")}</span>
        <ChevronRight className="approval-inbox-chevron" size={16} aria-hidden="true" />
      </button>) : <div className="empty-state approval-empty"><Mail size={22} aria-hidden="true" /><strong>No approval conversations</strong><p>New playbook drafts and individual replies will appear here.</p></div>}
    </section>

    <section className="approval-conversation-panel" id="approval-conversation-panel" aria-label={selected ? `Conversation with ${selected.contact}` : "Approval conversation"} aria-live="polite">
      {selected ? <>
        <header className="approval-conversation-header">
          <button className="icon-button approval-conversation-close" type="button" onClick={() => setSelectedKey(null)} aria-label="Close conversation"><X size={18} /></button>
          <span className="activity-icon">{selected.kind === "playbook" ? <MessageSquareText size={16} aria-hidden="true" /> : <Mail size={16} aria-hidden="true" />}</span>
          <div><p className="eyebrow">{selected.kind === "playbook" ? "Playbook campaign" : "Reply campaign"}</p><h3>{selected.topic}</h3><small>{selected.contact} · {selected.email} · {selected.drafts.length} message{selected.drafts.length === 1 ? "" : "s"}</small></div>
          <span className={`status-badge status-${selected.status.replaceAll("_", "-")}`}>{selected.status.replaceAll("_", " ")}</span>
          <div className="approval-conversation-campaign"><Workflow size={13} aria-hidden="true" /><span><small>Current campaign</small><strong>{selected.campaign}</strong></span></div>
        </header>
        <div className="approval-message-thread" role="log" aria-label="Campaign email history">
          {selected.conversation.length ? selected.conversation.map(message => <ConversationMessage message={message} key={message.id} />) : <div className="approval-thread-empty"><Mail size={18} aria-hidden="true" /><span><strong>No earlier synchronized emails</strong><small>The current draft is shown below.</small></span></div>}
          {selected.currentDraft ? <div className="approval-current-draft" aria-label="Current email awaiting approval">
            <div className="approval-current-label"><span>Current email</span><small>Not sent until approved</small></div>
            {selected.kind === "playbook" ? (() => {
              const draft = selected.currentDraft;
              const editable = draft.status === "draft" && (!["pending","processing"].includes(draft.agentStatus) || (draft.agentStatus === "pending" && !draft.agentClaimedAt));
              if (editable) return <><ClientPlaybookDraftControl id={draft.id} clientAppId={draft.appId} channel={draft.channel} subject={draft.subject} body={draft.body} contact={draft.contactName} revision={draft.agentRegenerationCount} agentStatus={draft.agentStatus} />{draft.agentFailureCode ? <p className="approval-error">Draft generation stopped: <code>{draft.agentFailureCode}</code></p> : null}</>;
              return <><article className="approval-message approval-message-current"><h4>{draft.subject || `${draft.channel} message`}</h4><p>{draft.body}</p></article>{draft.agentFailureCode ? <p className="approval-error">Draft generation stopped: <code>{draft.agentFailureCode}</code></p> : null}</>;
            })() : <><article className="approval-message approval-message-current"><h4>{selected.currentDraft.subject}</h4><p>{selected.currentDraft.body}</p></article>{selected.currentDraft.lastError ? <p className="approval-error">{selected.currentDraft.lastError}</p> : null}<ReplyApprovalControl id={selected.currentDraft.id} status={selected.currentDraft.status} contact={selected.currentDraft.contact} body={selected.currentDraft.body} canRegenerate={Boolean(selected.currentDraft.automationRunId)} /></>}
          </div> : <div className="approval-thread-complete"><CheckCheck size={18} aria-hidden="true" /><span><strong>No draft awaiting approval</strong><small>The latest campaign email has already been sent.</small></span></div>}
        </div>
      </> : <div className="approval-conversation-placeholder"><MessageSquareText size={28} aria-hidden="true" /><strong>Select a conversation</strong><p>Open an approval to review the complete campaign history and current draft without leaving this page.</p></div>}
    </section>
  </div>;
}
