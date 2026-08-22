"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { setAutomaticInternalTask, type WorkflowActionState } from "../dashboard/automations/actions";

const initialState: WorkflowActionState = { ok: false, message: "" };

function ConfigurationSubmit({ enabled }: { enabled: boolean }) {
  const { pending } = useFormStatus();
  return <button className={enabled ? "secondary-button compact-button" : "primary-button compact-button"} disabled={pending} name="enabled" value="true" type="submit">{pending ? "Saving…" : enabled ? "Save configuration" : "Enable automatic task"}</button>;
}

function DisableSubmit() {
  const { pending } = useFormStatus();
  return <button className="danger-button compact-button" disabled={pending} name="enabled" value="false" type="submit">{pending ? "Saving…" : "Disable"}</button>;
}

export function AutomaticInternalTaskControl({ enabled, taskTitle, dueHours, isAdmin }: { enabled: boolean; taskTitle: string; dueHours: number; isAdmin: boolean }) {
  const [state, action] = useActionState(setAutomaticInternalTask, initialState);
  if (!isAdmin) return <p className="automatic-task-role-note">Only organization administrators can configure this automatic action.</p>;
  return <form className="automatic-task-control" action={action} onSubmit={event => {
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const nextEnabled = submitter?.value !== "false";
    const prompt = nextEnabled
      ? "Enable automatic internal tasks for new prospect replies? This creates CRM tasks only and never sends externally."
      : "Disable automatic internal tasks? Existing CRM tasks will remain unchanged.";
    if (!window.confirm(prompt)) event.preventDefault();
  }}>
    <label htmlFor="automatic-task-title">Task title<input id="automatic-task-title" name="task_title" defaultValue={taskTitle} minLength={3} maxLength={200} required /></label>
    <label htmlFor="automatic-task-due">Due after reply <span><input id="automatic-task-due" name="due_hours" type="number" defaultValue={dueHours} min={1} max={168} step={1} required /> hours</span></label>
    <div className="automatic-task-buttons">{enabled ? <><ConfigurationSubmit enabled /><DisableSubmit /></> : <ConfigurationSubmit enabled={false} />}</div>
    <small>The current administrator becomes the task assignee when this action is enabled.</small>
    {state.message ? <p className={state.ok ? "action-feedback success" : "action-feedback error"} role={state.ok ? "status" : "alert"}>{state.message}</p> : null}
  </form>;
}
