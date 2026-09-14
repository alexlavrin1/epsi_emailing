"use client";

import { useMemo, useState } from "react";
import { ChevronRight, Mail, MessageSquareText, UserRound, Workflow, X } from "lucide-react";
import type { ApprovalConversationMessage, ApprovalData } from "../../lib/dashboard-data";
import { ClientPlaybookDraftControl, ReplyApprovalControl } from "./approval-controls";

type ClientDraft = ApprovalData["clientDrafts"][number];
type ReplyDraft = ApprovalData["replies"][number];
type InboxItem =
  | { key: string; kind: "playbook"; topic: string; contact: string; email: string; company: string; campaign: string; status: string; createdAt: string; draft: ClientDraft }
  | { key: string; kind: "reply"; topic: string; contact: string; email: string; company: string; campaign: string; status: string; createdAt: string; draft: ReplyDraft };

function formatMessageTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "Unknown time";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}

function visibleClientStatus(draft: ClientDraft) {
  return draft.channel === "email" && draft.status === "approved" ? draft.deliveryStatus : draft.status;
}

function ConversationMessage({ message }: { message: ApprovalConversationMessage }) {
  return <article className={`approval-message approval-message-${message.direction}`}>
    <header><strong>{message.direction === "inbound" ? "Contact" : "EpsiFlow"}</strong><time dateTime={message.occurredAt}>{formatMessageTime(message.occurredAt)}</time></header>
    {message.subject && message.subject !== "No subject" ? <h4>{message.subject}</h4> : null}
    <p>{message.body}</p>
  </article>;
}

export function ApprovalInbox({ clientDrafts, replies }: { clientDrafts: ClientDraft[]; replies: ReplyDraft[] }) {
  const items = useMemo<InboxItem[]>(() => [
    ...clientDrafts.map(draft => ({ key: `playbook:${draft.id}`, kind: "playbook" as const, topic: draft.subject || `${draft.channel} message`, contact: draft.contactName, email: draft.contactEmail, company: draft.appName, campaign: draft.playbookName, status: visibleClientStatus(draft), createdAt: draft.deliveredAt || draft.createdAt, draft })),
    ...replies.map(draft => ({ key: `reply:${draft.id}`, kind: "reply" as const, topic: draft.subject, contact: draft.contact, email: draft.email, company: draft.company, campaign: draft.campaignName, status: draft.status, createdAt: draft.createdAt, draft })),
  ].sort((a,b) => b.createdAt.localeCompare(a.createdAt)), [clientDrafts, replies]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const selected = items.find(item => item.key === selectedKey) ?? null;

  return <div className={`approval-inbox${selected ? " has-selection" : ""}`}>
    <section className="approval-inbox-list" aria-label="Approval conversations">
      {items.length ? items.map(item => <button className={`approval-inbox-row${selectedKey === item.key ? " is-selected" : ""}`} type="button" key={item.key} onClick={() => setSelectedKey(item.key)} aria-expanded={selectedKey === item.key} aria-controls="approval-conversation-panel">
        <span className="approval-inbox-avatar" aria-hidden="true"><UserRound size={17} /></span>
        <span className="approval-inbox-copy">
          <span className="approval-inbox-contact"><strong>{item.contact}</strong><time dateTime={item.createdAt}>{formatMessageTime(item.createdAt)}</time></span>
          <span className="approval-inbox-topic">{item.topic}</span>
          <span className="approval-inbox-campaign"><Workflow size={12} aria-hidden="true" />{item.campaign}</span>
          <span className="approval-inbox-meta">{item.company} · {item.email}</span>
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
          <div><p className="eyebrow">{selected.kind === "playbook" ? "Playbook campaign" : "Single reply"}</p><h3>{selected.topic}</h3><small>{selected.contact} · {selected.email}</small></div>
          <span className={`status-badge status-${selected.status.replaceAll("_", "-")}`}>{selected.status.replaceAll("_", " ")}</span>
          <div className="approval-conversation-campaign"><Workflow size={13} aria-hidden="true" /><span><small>Current campaign</small><strong>{selected.campaign}</strong></span></div>
        </header>
        <div className="approval-message-thread" role="log" aria-label="Email history">
          {selected.draft.conversation.length ? selected.draft.conversation.map(message => <ConversationMessage message={message} key={message.id} />) : <div className="approval-thread-empty"><Mail size={18} aria-hidden="true" /><span><strong>No earlier synchronized emails</strong><small>The current draft is shown below.</small></span></div>}
          <div className="approval-current-draft" aria-label="Current email awaiting approval">
            <div className="approval-current-label"><span>Current email</span><small>Not sent until approved</small></div>
            {selected.kind === "playbook" ? (() => {
              const draft = selected.draft;
              const editable = draft.status === "draft" && (!["pending","processing"].includes(draft.agentStatus) || (draft.agentStatus === "pending" && !draft.agentClaimedAt));
              if (editable) return <><ClientPlaybookDraftControl id={draft.id} clientAppId={draft.appId} channel={draft.channel} subject={draft.subject} body={draft.body} contact={draft.contactName} revision={draft.agentRegenerationCount} agentStatus={draft.agentStatus} />{draft.agentFailureCode ? <p className="approval-error">Draft generation stopped: <code>{draft.agentFailureCode}</code></p> : null}</>;
              return <><article className="approval-message approval-message-current"><h4>{draft.subject || `${draft.channel} message`}</h4><p>{draft.body}</p></article>{draft.agentFailureCode ? <p className="approval-error">Draft generation stopped: <code>{draft.agentFailureCode}</code></p> : null}</>;
            })() : <><article className="approval-message approval-message-current"><h4>{selected.draft.subject}</h4><p>{selected.draft.body}</p></article>{selected.draft.lastError ? <p className="approval-error">{selected.draft.lastError}</p> : null}<ReplyApprovalControl id={selected.draft.id} status={selected.draft.status} contact={selected.draft.contact} body={selected.draft.body} canRegenerate={Boolean(selected.draft.automationRunId)} /></>}
          </div>
        </div>
      </> : <div className="approval-conversation-placeholder"><MessageSquareText size={28} aria-hidden="true" /><strong>Select a conversation</strong><p>Open an approval to review the complete campaign history and current draft without leaving this page.</p></div>}
    </section>
  </div>;
}
