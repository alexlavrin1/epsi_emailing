"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { setAutomationRateLimit, setAutomationRuntimePause, type WorkflowActionState } from "../dashboard/automations/actions";

const initialState: WorkflowActionState = { ok: false, message: "" };

function RuntimeSubmit({ paused }: { paused: boolean }) {
  const { pending } = useFormStatus();
  return <button className={paused ? "primary-button compact-button" : "danger-button compact-button"} disabled={pending} type="submit">{pending ? "Updating…" : paused ? "Resume all automations" : "Pause all automations"}</button>;
}

export function AutomationRuntimeControl({ paused, isAdmin }: { paused: boolean; isAdmin: boolean }) {
  const [state, action] = useActionState(setAutomationRuntimePause, initialState);
  if (!isAdmin) return <p className="runtime-role-note">Only organization administrators can change the global runtime state.</p>;
  return <form className="runtime-control-form" action={action} onSubmit={event => {
    const prompt = paused
      ? "Resume all automations? Queued work may be claimed by the next worker cycle."
      : "Pause all automations? New and queued automation work will stop being claimed. A provider call already in flight may still finish.";
    if (!window.confirm(prompt)) event.preventDefault();
  }}>
    <input type="hidden" name="paused" value={paused ? "false" : "true"} />
    {!paused ? <label>Reason for emergency pause <span>(required)</span><input name="reason" required minLength={3} maxLength={500} placeholder="Example: investigating unexpected draft volume" /></label> : null}
    <RuntimeSubmit paused={paused} />
    {state.message ? <p className={state.ok ? "action-feedback success" : "action-feedback error"} role={state.ok ? "status" : "alert"}>{state.message}</p> : null}
  </form>;
}

function RateLimitSubmit() {
  const { pending } = useFormStatus();
  return <button className="secondary-button compact-button" disabled={pending} type="submit">{pending ? "Saving…" : "Save limit"}</button>;
}

export function AutomationRateLimitControl({ hourlyLimit, isAdmin }: { hourlyLimit: number; isAdmin: boolean }) {
  const [state, action] = useActionState(setAutomationRateLimit, initialState);
  if (!isAdmin) return <p className="rate-limit-role-note">Only organization administrators can change this limit.</p>;
  return <form className="rate-limit-control" action={action}>
    <label htmlFor="hourly-run-limit">Maximum automation runs per hour</label>
    <div><input id="hourly-run-limit" name="hourly_limit" type="number" min={1} max={1000} step={1} defaultValue={hourlyLimit} required /><RateLimitSubmit /></div>
    <small>Applies to new runs only. Existing queued work is unchanged.</small>
    {state.message ? <p className={state.ok ? "action-feedback success" : "action-feedback error"} role={state.ok ? "status" : "alert"}>{state.message}</p> : null}
  </form>;
}
