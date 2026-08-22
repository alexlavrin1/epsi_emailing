"use client";
import { useActionState } from "react";
import { setRetentionPeriod, type RetentionActionState } from "../dashboard/data-governance/actions";
const initialState: RetentionActionState = { ok: false, message: "" };
export function RetentionPolicyControl({ category, days, minimum }: { category: string; days: number; minimum: number }) {
  const [state, action, pending] = useActionState(setRetentionPeriod, initialState);
  return <form className="retention-control" action={action}><input type="hidden" name="category" value={category} /><label><span className="sr-only">Retention days</span><input name="retention_days" type="number" min={minimum} max={3650} defaultValue={days} required /><span>days</span></label><button className="secondary-button" type="submit" disabled={pending}>{pending ? "Saving…" : "Update draft"}</button>{state.message ? <p className={state.ok ? "action-feedback success" : "action-feedback error"} role={state.ok ? "status" : "alert"}>{state.message}</p> : null}</form>;
}
