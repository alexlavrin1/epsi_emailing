"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { RotateCcw } from "lucide-react";
import { retryAutomationRun, type WorkflowActionState } from "../dashboard/automations/actions";

const initialState: WorkflowActionState = { ok: false, message: "" };

function RetrySubmit() {
  const { pending } = useFormStatus();
  return <button className="secondary-button compact-button" disabled={pending} type="submit"><RotateCcw size={14} aria-hidden="true" />{pending ? "Queueing…" : "Retry preparation"}</button>;
}

export function AutomationRunRetryControl({ runId, retryCount }: { runId: string; retryCount: number }) {
  const [state, action] = useActionState(retryAutomationRun, initialState);
  return <form className="automation-run-retry" action={action} onSubmit={event => {
    if (!window.confirm(`Retry draft preparation? This is retry ${retryCount + 1} of 3. Stop conditions will be checked again and any new draft will still require approval.`)) event.preventDefault();
  }}>
    <input type="hidden" name="run_id" value={runId} />
    <RetrySubmit />
    {state.message ? <p className={state.ok ? "action-feedback success" : "action-feedback error"} role={state.ok ? "status" : "alert"}>{state.message}</p> : null}
  </form>;
}
