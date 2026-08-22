"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { acknowledgeAutomationAlert, type WorkflowActionState } from "../dashboard/automations/actions";

const initialState: WorkflowActionState = { ok: false, message: "" };

function AcknowledgeSubmit() {
  const { pending } = useFormStatus();
  return <button className="secondary-button compact-button" disabled={pending} type="submit">{pending ? "Acknowledging…" : "Acknowledge"}</button>;
}

export function AutomationAlertControl({ alertId }: { alertId: string }) {
  const [state, action] = useActionState(acknowledgeAutomationAlert, initialState);
  return <form className="automation-alert-control" action={action}>
    <input type="hidden" name="alert_id" value={alertId} />
    <AcknowledgeSubmit />
    {state.message ? <p className={state.ok ? "action-feedback success" : "action-feedback error"} role={state.ok ? "status" : "alert"}>{state.message}</p> : null}
  </form>;
}
