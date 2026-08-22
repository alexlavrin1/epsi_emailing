"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { queueReply, retryRecoveryMessage, updateReplyDraft, type ApprovalActionState } from "../dashboard/approvals/actions";

const initialState: ApprovalActionState = { ok: false, message: "" };

function ActionButton({ label, pendingLabel, tone = "primary" }: { label: string; pendingLabel: string; tone?: "primary" | "secondary" }) {
  const { pending } = useFormStatus();
  return <button className={`${tone}-button compact-button`} disabled={pending} type="submit">{pending ? pendingLabel : label}</button>;
}

export function ReplyApprovalControl({ id, status, contact, body }: { id: string; status: string; contact: string; body: string }) {
  const [state, action] = useActionState(queueReply, initialState);
  const [editState, editAction] = useActionState(updateReplyDraft, initialState);
  if (!["draft", "failed"].includes(status)) return null;
  return <div className="approval-control"><form action={action} onSubmit={event => { if (!window.confirm(`Approve and queue this email reply to ${contact}? The backend will send it on the next outreach cycle.`)) event.preventDefault(); }}><input type="hidden" name="reply_id" value={id} /><ActionButton label={status === "failed" ? "Approve retry" : "Approve & queue"} pendingLabel="Queueing…" /></form>{state.message ? <p className={state.ok ? "action-feedback success" : "action-feedback error"} role={state.ok ? "status" : "alert"}>{state.message}</p> : null}<details className="approval-editor"><summary>Edit draft</summary><form className="action-form" action={editAction}><input type="hidden" name="reply_id" value={id} /><label>Reply text <span>(required)</span><textarea name="body" required minLength={1} maxLength={10000} defaultValue={body} /></label><ActionButton label="Save draft" pendingLabel="Saving…" tone="secondary" /></form>{editState.message ? <p className={editState.ok ? "action-feedback success" : "action-feedback error"} role={editState.ok ? "status" : "alert"}>{editState.message}</p> : null}</details></div>;
}

export function RecoveryRetryControl({ id, customer, channel }: { id: string; customer: string; channel: string }) {
  const [state, action] = useActionState(retryRecoveryMessage, initialState);
  return <div className="approval-control"><form action={action} onSubmit={event => { if (!window.confirm(`Retry this failed ${channel} delivery for ${customer}? The recovery worker will re-check payment state and recipient permissions first.`)) event.preventDefault(); }}><input type="hidden" name="message_id" value={id} /><ActionButton label="Approve retry" pendingLabel="Queueing…" tone="secondary" /></form>{state.message ? <p className={state.ok ? "action-feedback success" : "action-feedback error"} role={state.ok ? "status" : "alert"}>{state.message}</p> : null}</div>;
}
