"use client";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { acknowledgeApplicationError, type MonitoringActionState } from "../dashboard/monitoring/actions";
const initialState: MonitoringActionState = { ok: false, message: "" };
function Submit() { const { pending } = useFormStatus(); return <button className="secondary-button compact-button" type="submit" disabled={pending}>{pending ? "Acknowledging…" : "Acknowledge"}</button>; }
export function ApplicationErrorControl({ eventId }: { eventId: string }) { const [state, action] = useActionState(acknowledgeApplicationError, initialState); return <form className="application-error-control" action={action}><input type="hidden" name="event_id" value={eventId} /><Submit />{state.message ? <p className={state.ok ? "action-feedback success" : "action-feedback error"} role={state.ok ? "status" : "alert"}>{state.message}</p> : null}</form>; }
