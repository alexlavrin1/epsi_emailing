"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import type { CampaignRow } from "../../lib/dashboard-data";
import { setCampaignStatus, type CampaignActionState } from "../dashboard/campaigns/actions";

const initialState: CampaignActionState = { ok: false, message: "" };

function CampaignSubmit({ status }: { status: string }) {
  const { pending } = useFormStatus();
  return <button className={status === "active" ? "secondary-button compact-button" : "primary-button compact-button"} disabled={pending} type="submit">{pending ? "Updating…" : status === "active" ? "Pause" : "Resume"}</button>;
}

export function CampaignControls({ campaign, ready }: { campaign: CampaignRow; ready: boolean }) {
  const [state, action] = useActionState(setCampaignStatus, initialState);
  const nextStatus = campaign.status === "active" ? "paused" : "active";
  if (campaign.status === "completed") return <span className="campaign-locked">Completed</span>;
  if (!ready) return <span className="campaign-locked">Migration 008 required</span>;
  return <div className="campaign-action"><form action={action} onSubmit={event => { if (nextStatus === "active" && !window.confirm("Resume this campaign? Scheduled sends may run on the next outreach cycle.")) event.preventDefault(); }}><input type="hidden" name="campaign_id" value={campaign.id} /><input type="hidden" name="status" value={nextStatus} /><CampaignSubmit status={campaign.status} /></form>{state.message ? <p className={state.ok ? "action-feedback success" : "action-feedback error"} role={state.ok ? "status" : "alert"}>{state.message}</p> : null}</div>;
}
