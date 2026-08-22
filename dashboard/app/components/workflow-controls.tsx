"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import type { AutomationWorkflow } from "../../lib/dashboard-data";
import { createReplyWorkflow, setWorkflowStatus, updateReplyWorkflow, type WorkflowActionState } from "../dashboard/automations/actions";

const initialState: WorkflowActionState = { ok: false, message: "" };
const defaultTemplate = "Hi {{firstName}},\n\nThank you for your reply about {{subject}}. I’ve received your message and will follow up shortly.\n\nBest,\nEpsiFlow";

function Submit({ idle, pending }: { idle: string; pending: string }) {
  const status = useFormStatus();
  return <button className="primary-button compact-button" disabled={status.pending} type="submit">{status.pending ? pending : idle}</button>;
}

function DefinitionFields({ workflow }: { workflow?: AutomationWorkflow }) {
  return <>
    <label>Workflow name <span>(required)</span><input name="name" required minLength={3} maxLength={120} defaultValue={workflow?.name || "Reply acknowledgement"} /></label>
    <label>Description <span>(optional)</span><input name="description" maxLength={500} defaultValue={workflow?.description || "Prepare a reviewable acknowledgement when an active outreach prospect replies."} /></label>
    <label>Delay in minutes <span>(0–10,080)</span><input name="delay_minutes" type="number" min={0} max={10080} step={1} required defaultValue={workflow?.delayMinutes ?? 0} /></label>
    <label>Reply template <span>(required)</span><textarea name="body_template" required minLength={1} maxLength={10000} defaultValue={workflow?.currentTemplate || defaultTemplate} /></label>
    <p className="workflow-variable-help">Available variables: <code>{"{{firstName}}"}</code> <code>{"{{lastName}}"}</code> <code>{"{{company}}"}</code> <code>{"{{email}}"}</code> <code>{"{{subject}}"}</code></p>
  </>;
}

export function WorkflowBuilder({ isAdmin }: { isAdmin: boolean }) {
  const [state, action] = useActionState(createReplyWorkflow, initialState);
  if (!isAdmin) return <div className="workflow-role-note">Only organization administrators can create or activate workflow definitions.</div>;
  return <form className="action-form workflow-form" action={action}><DefinitionFields /><Submit idle="Save draft workflow" pending="Saving workflow…" />{state.message ? <p className={state.ok ? "action-feedback success" : "action-feedback error"} role={state.ok ? "status" : "alert"}>{state.message}</p> : null}</form>;
}

export function WorkflowControls({ workflow, isAdmin }: { workflow: AutomationWorkflow; isAdmin: boolean }) {
  const [statusState, statusAction] = useActionState(setWorkflowStatus, initialState);
  const [editState, editAction] = useActionState(updateReplyWorkflow, initialState);
  if (!isAdmin) return <span className="campaign-locked">Admin managed</span>;
  const nextStatus = workflow.status === "active" ? "paused" : "active";
  return <div className="workflow-controls">
    <form action={statusAction} onSubmit={event => {
      const prompt = nextStatus === "active"
        ? "Activate this workflow? New prospect replies may create drafts, but every draft will still require approval before sending."
        : "Pause this workflow? No queued draft-preparation runs will execute until it is active again.";
      if (!window.confirm(prompt)) event.preventDefault();
    }}><input type="hidden" name="workflow_id" value={workflow.id} /><input type="hidden" name="status" value={nextStatus} /><Submit idle={nextStatus === "active" ? "Activate" : "Pause"} pending="Updating…" /></form>
    {statusState.message ? <p className={statusState.ok ? "action-feedback success" : "action-feedback error"} role={statusState.ok ? "status" : "alert"}>{statusState.message}</p> : null}
    {workflow.status !== "active" ? <details className="workflow-editor"><summary>Create new version</summary><form className="action-form" action={editAction}><input type="hidden" name="workflow_id" value={workflow.id} /><DefinitionFields workflow={workflow} /><Submit idle="Save new version" pending="Saving version…" />{editState.message ? <p className={editState.ok ? "action-feedback success" : "action-feedback error"} role={editState.ok ? "status" : "alert"}>{editState.message}</p> : null}</form></details> : <p className="workflow-edit-lock">Pause before editing the definition.</p>}
  </div>;
}
