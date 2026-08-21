"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { FilePenLine } from "lucide-react";
import { createReplyDraft, type ApprovalActionState } from "../dashboard/approvals/actions";

const initialState: ApprovalActionState = { ok: false, message: "" };

function DraftButton() {
  const { pending } = useFormStatus();
  return <button className="secondary-button compact-button" disabled={pending} type="submit">{pending ? "Saving…" : "Save for approval"}</button>;
}

export function ReplyDraftForm({ replyId, recipient, ready }: { replyId: string; recipient: string; ready: boolean }) {
  const [state, action] = useActionState(createReplyDraft, initialState);
  return <details className="reply-composer"><summary><FilePenLine size={15} aria-hidden="true" />Draft response</summary>{ready ? <form action={action}><input type="hidden" name="prospect_reply_id" value={replyId} /><label htmlFor={`reply-body-${replyId}`}>Reply to {recipient}</label><textarea id={`reply-body-${replyId}`} name="body" maxLength={10000} required rows={6} placeholder="Write a concise, helpful response…" /><p className="field-help">Saving creates a draft only. A separate approval is required before delivery.</p><DraftButton />{state.message ? <p className={state.ok ? "action-feedback success" : "action-feedback error"} role={state.ok ? "status" : "alert"}>{state.message}</p> : null}</form> : <p className="setup-inline">Migration 009 is required before drafts can be saved.</p>}</details>;
}
