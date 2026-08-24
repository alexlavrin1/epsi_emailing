"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { decideClientPlaybookDraft, disposeReply, queueReply, regenerateClientPlaybookAgentDraft, retryRecoveryMessage, updateClientPlaybookDraft, updateReplyDraft, type ApprovalActionState } from "../dashboard/approvals/actions";

const initialState: ApprovalActionState = { ok: false, message: "" };

function ActionButton({ label, pendingLabel, tone = "primary", disabled = false }: { label: string; pendingLabel: string; tone?: "primary" | "secondary" | "danger"; disabled?: boolean }) {
  const { pending } = useFormStatus();
  return <button className={`${tone}-button compact-button`} disabled={pending || disabled} type="submit">{pending ? pendingLabel : label}</button>;
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

export function ClientPlaybookDraftControl({ id, clientAppId, channel, subject, body, contact }: { id: string; clientAppId: string; channel: "email" | "slack"; subject: string | null; body: string; contact: string }) {
  const [approveState, approveAction] = useActionState(decideClientPlaybookDraft, initialState);
  const [cancelState, cancelAction] = useActionState(decideClientPlaybookDraft, initialState);
  const [editState, editAction] = useActionState(updateClientPlaybookDraft, initialState);
  const [regenerateState, regenerateAction] = useActionState(regenerateClientPlaybookAgentDraft, initialState);
  const [draftSubject, setDraftSubject] = useState(subject || "");
  const [draftBody, setDraftBody] = useState(body);
  const feedbackHelpId = `ai-feedback-help-${id}`;
  const editorHelpId = `draft-editor-help-${id}`;
  const dirty = draftSubject !== (subject || "") || draftBody !== body;
  return <div className="approval-control client-draft-control">
    <form className="action-form client-inline-draft-editor" action={editAction}>
      <input type="hidden" name="draft_id" value={id} />
      {channel === "email" ? <label>Draft subject <span>(required)</span><input name="subject" required maxLength={998} value={draftSubject} onChange={event => setDraftSubject(event.target.value)} /></label> : <input type="hidden" name="subject" value="" />}
      <label>Draft message <span>(required)</span><textarea name="body" required minLength={1} maxLength={10000} value={draftBody} onChange={event => setDraftBody(event.target.value)} aria-describedby={editorHelpId} /></label>
      <small id={editorHelpId}>Edit the generated text directly, then save your changes. Saving does not send the message.</small>
      <ActionButton label="Save changes" pendingLabel="Saving…" tone="secondary" disabled={!dirty} />
    </form>
    <Feedback state={editState} />
    <form className="action-form ai-regeneration-form" action={regenerateAction} onSubmit={event => { if (!window.confirm(`Regenerate this draft for ${contact} with AI? The current draft will remain unsent and the replacement will still require approval.`)) event.preventDefault(); }}><input type="hidden" name="draft_id" value={id} /><input type="hidden" name="client_app_id" value={clientAppId} /><label>Feedback for AI <span>(optional)</span><textarea name="feedback" maxLength={4000} aria-describedby={feedbackHelpId} placeholder="For example: answer the pricing question first, make the tone warmer, and suggest the $500 plan." /></label><small id={feedbackHelpId}>The AI will use this guidance together with the full stored conversation and playbook. Maximum 4,000 characters.</small><ActionButton label="Regenerate with AI" pendingLabel="Regenerating…" tone="secondary" disabled={dirty} /></form>
    <Feedback state={regenerateState} />
    {dirty ? <p className="client-draft-unsaved" role="status">Unsaved changes — save them before approval.</p> : null}
    <div className="client-draft-actions">
      <form action={approveAction} onSubmit={event => { if (!window.confirm(`Approve this ${channel} draft for ${contact}? Approval records readiness only; it will not send.`)) event.preventDefault(); }}><input type="hidden" name="draft_id" value={id} /><input type="hidden" name="decision" value="approve" /><ActionButton label="Approve as ready" pendingLabel="Approving…" disabled={dirty} /></form>
      <form action={cancelAction} onSubmit={event => { if (!window.confirm(`Cancel this ${channel} draft for ${contact}? Nothing will be sent.`)) event.preventDefault(); }}><input type="hidden" name="draft_id" value={id} /><input type="hidden" name="decision" value="cancel" /><ActionButton label="Cancel" pendingLabel="Cancelling…" tone="danger" /></form>
    </div>
    <Feedback state={approveState} /><Feedback state={cancelState} />
  </div>;
}
