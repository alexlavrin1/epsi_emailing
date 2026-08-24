"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { decideClientPlaybookDraft, disposeReply, queueReply, retryClientPlaybookAgentDraft, retryRecoveryMessage, updateClientPlaybookDraft, updateReplyDraft, type ApprovalActionState } from "../dashboard/approvals/actions";

const initialState: ApprovalActionState = { ok: false, message: "" };

function ActionButton({ label, pendingLabel, tone = "primary" }: { label: string; pendingLabel: string; tone?: "primary" | "secondary" | "danger" }) {
  const { pending } = useFormStatus();
  return <button className={`${tone}-button compact-button`} disabled={pending} type="submit">{pending ? pendingLabel : label}</button>;
}

function Feedback({ state }: { state: ApprovalActionState }) {
  return state.message ? <p className={state.ok ? "action-feedback success" : "action-feedback error"} role={state.ok ? "status" : "alert"}>{state.message}</p> : null;
}

export function ReplyApprovalControl({ id, status, contact, body }: { id: string; status: string; contact: string; body: string }) {
  const [state, action] = useActionState(queueReply, initialState);
  const [editState, editAction] = useActionState(updateReplyDraft, initialState);
  const [skipState, skipAction] = useActionState(disposeReply, initialState);
  const [cancelState, cancelAction] = useActionState(disposeReply, initialState);
  if (!["draft", "failed"].includes(status)) return null;
  return <div className="approval-control"><form action={action} onSubmit={event => { if (!window.confirm(`Approve and queue this email reply to ${contact}? The backend will send it on the next outreach cycle.`)) event.preventDefault(); }}><input type="hidden" name="reply_id" value={id} /><ActionButton label={status === "failed" ? "Approve retry" : "Approve & queue"} pendingLabel="Queueing…" /></form>{state.message ? <p className={state.ok ? "action-feedback success" : "action-feedback error"} role={state.ok ? "status" : "alert"}>{state.message}</p> : null}<details className="approval-editor"><summary>Edit draft</summary><form className="action-form" action={editAction}><input type="hidden" name="reply_id" value={id} /><label>Reply text <span>(required)</span><textarea name="body" required minLength={1} maxLength={10000} defaultValue={body} /></label><ActionButton label="Save draft" pendingLabel="Saving…" tone="secondary" /></form>{editState.message ? <p className={editState.ok ? "action-feedback success" : "action-feedback error"} role={editState.ok ? "status" : "alert"}>{editState.message}</p> : null}</details><div className="approval-dispositions" aria-label="Decline this reply"><form action={skipAction} onSubmit={event => { if (!window.confirm(`Skip this reply to ${contact}? The draft will close and nothing will be sent.`)) event.preventDefault(); }}><input type="hidden" name="reply_id" value={id} /><input type="hidden" name="decision" value="skip" /><ActionButton label="Skip reply" pendingLabel="Skipping…" tone="secondary" /></form><form action={cancelAction} onSubmit={event => { if (!window.confirm(`Cancel this reply to ${contact}? The draft will close and nothing will be sent.`)) event.preventDefault(); }}><input type="hidden" name="reply_id" value={id} /><input type="hidden" name="decision" value="cancel" /><ActionButton label="Cancel" pendingLabel="Cancelling…" tone="danger" /></form></div>{skipState.message ? <p className={skipState.ok ? "action-feedback success" : "action-feedback error"} role={skipState.ok ? "status" : "alert"}>{skipState.message}</p> : null}{cancelState.message ? <p className={cancelState.ok ? "action-feedback success" : "action-feedback error"} role={cancelState.ok ? "status" : "alert"}>{cancelState.message}</p> : null}</div>;
}

export function RecoveryRetryControl({ id, customer, channel }: { id: string; customer: string; channel: string }) {
  const [state, action] = useActionState(retryRecoveryMessage, initialState);
  return <div className="approval-control"><form action={action} onSubmit={event => { if (!window.confirm(`Retry this failed ${channel} delivery for ${customer}? The recovery worker will re-check payment state and recipient permissions first.`)) event.preventDefault(); }}><input type="hidden" name="message_id" value={id} /><ActionButton label="Approve retry" pendingLabel="Queueing…" tone="secondary" /></form>{state.message ? <p className={state.ok ? "action-feedback success" : "action-feedback error"} role={state.ok ? "status" : "alert"}>{state.message}</p> : null}</div>;
}

export function ClientPlaybookDraftControl({ id, channel, subject, body, contact, agentStatus }: { id: string; channel: "email" | "slack"; subject: string | null; body: string; contact: string; agentStatus: string }) {
  const [approveState, approveAction] = useActionState(decideClientPlaybookDraft, initialState);
  const [cancelState, cancelAction] = useActionState(decideClientPlaybookDraft, initialState);
  const [editState, editAction] = useActionState(updateClientPlaybookDraft, initialState);
  const [retryState, retryAction] = useActionState(retryClientPlaybookAgentDraft, initialState);
  return <div className="approval-control client-draft-control">{agentStatus === "failed" ? <form action={retryAction} onSubmit={event => { if (!window.confirm(`Retry AI drafting for ${contact}? The current fallback stays visible until the worker prepares a replacement, and nothing will be sent.`)) event.preventDefault(); }}><input type="hidden" name="draft_id" value={id} /><ActionButton label="Retry AI draft" pendingLabel="Queueing retry…" tone="secondary" /></form> : null}<Feedback state={retryState} /><form action={approveAction} onSubmit={event => { if (!window.confirm(`Approve this ${channel} draft for ${contact}? Approval records readiness only; it will not send.`)) event.preventDefault(); }}><input type="hidden" name="draft_id" value={id} /><input type="hidden" name="decision" value="approve" /><ActionButton label="Approve as ready" pendingLabel="Approving…" /></form><details className="approval-editor"><summary>Edit draft</summary><form className="action-form" action={editAction}><input type="hidden" name="draft_id" value={id} />{channel === "email" ? <label>Subject <span>(required)</span><input name="subject" required maxLength={998} defaultValue={subject || ""} /></label> : <input type="hidden" name="subject" value="" />}<label>Message <span>(required)</span><textarea name="body" required minLength={1} maxLength={10000} defaultValue={body} /></label><ActionButton label="Save draft" pendingLabel="Saving…" tone="secondary" /></form><Feedback state={editState} /></details><form action={cancelAction} onSubmit={event => { if (!window.confirm(`Cancel this ${channel} draft for ${contact}? Nothing will be sent.`)) event.preventDefault(); }}><input type="hidden" name="draft_id" value={id} /><input type="hidden" name="decision" value="cancel" /><ActionButton label="Cancel" pendingLabel="Cancelling…" tone="danger" /></form><Feedback state={approveState} /><Feedback state={cancelState} /></div>;
}
