"use client";

import { useActionState, useRef } from "react";
import { useFormStatus } from "react-dom";
import { X } from "lucide-react";
import type { ManagedPlaybook, ClientPlaybook } from "../../lib/client-playbook-data";
import { setWorkflowStatus, updateReplyWorkflow } from "../dashboard/automations/actions";
import { createClientPlaybook, setClientPlaybookStatus, updateClientPlaybook, type PlaybookActionState } from "../dashboard/playbooks/actions";
import { createClientPlaybookDraftAction } from "../dashboard/clients/actions";

const initial: PlaybookActionState = { ok: false, message: "" };
function Submit({ idle, pending, tone = "primary" }: { idle: string; pending: string; tone?: "primary" | "secondary" }) { const status = useFormStatus(); return <button className={`${tone}-button compact-button`} type="submit" disabled={status.pending}>{status.pending ? pending : idle}</button>; }
function Feedback({ state }: { state: PlaybookActionState }) { return state.message ? <p className={state.ok ? "action-feedback success" : "action-feedback error"} role={state.ok ? "status" : "alert"}>{state.message}</p> : null; }

const statuses = ["active","trialing","past_due","unpaid","incomplete","incomplete_expired","canceled","paused","none"];
const defaultBody = "Hi {{contactFirstName}},\n\nI wanted to check in and see how things are going with {{clientName}}. How are the ads performing, and is there anything you would like us to review or help improve?\n\nBest,\nEpsiFlow";
const defaultPrompt = "Review the complete client conversation and CRM/subscription context. Draft a concise, warm check-in that refers to the latest relevant topic, avoids unsupported claims, and ends with one low-friction question.";

export function ClientPlaybookBuilder({ isAdmin }: { isAdmin: boolean }) {
  const [state, action] = useActionState(createClientPlaybook, initial);
  if (!isAdmin) return <p className="workflow-role-note">Only organization administrators can create or activate playbooks.</p>;
  return <form className="action-form playbook-builder" action={action}>
    <label>Playbook name <span>(required)</span><input name="name" minLength={3} maxLength={120} defaultValue="Advertising progress check-in" required /></label>
    <label>Purpose <span>(optional)</span><input name="description" maxLength={500} defaultValue="Prepare a friendly client-success check-in about advertising performance and support needs." /></label>
    <label>Channel <span>(required)</span><select name="channel" defaultValue="email"><option value="email">Email</option><option value="slack">Slack</option></select></label>
    <label>Trigger <span>(required)</span><select name="trigger_type" defaultValue="manual_client_checkin"><option value="manual_client_checkin">Manual from client page</option><option value="scheduled_checkin">Scheduled relationship check-in</option><option value="stripe_cancellation">Stripe cancellation detected</option><option value="churn_reactivation">Churn reactivation</option></select></label>
    <p className="workflow-variable-help">Cancellation triggers require a canceled Stripe subscription. Churn reactivation requires the <strong>Churned</strong> relationship state below. Automatic triggers only prepare approval drafts.</p>
    <fieldset><legend>Relationship types</legend><div className="playbook-status-grid"><label><input type="checkbox" name="eligible_segments" value="lead"/><span>Lead</span></label><label><input type="checkbox" name="eligible_segments" value="epsiflow_direct" defaultChecked/><span>EpsiFlow Direct</span></label><label><input type="checkbox" name="eligible_segments" value="stripe_plan" defaultChecked/><span>Stripe plan</span></label></div></fieldset>
    <fieldset><legend>Relationship states</legend><div className="playbook-status-grid"><label><input type="checkbox" name="eligible_relationships" value="active" defaultChecked/><span>Active</span></label><label><input type="checkbox" name="eligible_relationships" value="churned"/><span>Churned</span></label></div></fieldset>
    <label>Cooldown in days <span>(automatic triggers)</span><input name="cooldown_days" type="number" min={1} max={365} defaultValue={30}/><small>One draft at most per client, contact, playbook, channel, and cooldown window.</small></label>
    <fieldset><legend>Eligible subscription states <span>(leave empty for any state)</span></legend><div className="playbook-status-grid">{statuses.map(status => <label key={status}><input type="checkbox" name="eligible_statuses" value={status} defaultChecked={["active","trialing"].includes(status)} /><span>{status.replaceAll("_", " ")}</span></label>)}</div></fieldset>
    <label>Email subject <span>(required for email)</span><input name="subject_template" maxLength={998} defaultValue="How are things going with {{clientName}}?" /></label>
    <label>Message template <span>(required)</span><textarea name="body_template" minLength={1} maxLength={10000} defaultValue={defaultBody} required /></label>
    <label>AI instructions <span>(required)</span><textarea name="agent_prompt" minLength={20} maxLength={12000} defaultValue={defaultPrompt} required /><small>This exact playbook instruction is added to the guarded system prompt together with the client&apos;s synchronized context.</small></label>
    <p className="workflow-variable-help">Variables: <code>{"{{clientName}}"}</code> <code>{"{{contactName}}"}</code> <code>{"{{contactFirstName}}"}</code> <code>{"{{subscriptionStatus}}"}</code> <code>{"{{productName}}"}</code> <code>{"{{billingInterval}}"}</code></p>
    <Submit idle="Save draft playbook" pending="Saving playbook…" /><Feedback state={state} />
  </form>;
}

export function ClientPlaybookStatusControl({ id, status }: { id: string; status: string }) {
  const [state, action] = useActionState(setClientPlaybookStatus, initial); const next = status === "active" ? "paused" : "active";
  return <div className="playbook-status-control"><form action={action} onSubmit={event => { if (!window.confirm(next === "active" ? "Activate this playbook? It can prepare drafts, but cannot send them." : "Pause this playbook? Existing drafts remain available for review.")) event.preventDefault(); }}><input type="hidden" name="playbook_id" value={id} /><input type="hidden" name="status" value={next} /><Submit idle={next === "active" ? "Activate" : "Pause"} pending="Updating…" tone="secondary" /></form><Feedback state={state} /></div>;
}

export function LeadPlaybookStatusControl({ id, status }: { id: string; status: string }) {
  const [state, action] = useActionState(setWorkflowStatus, initial); const next = status === "active" ? "paused" : "active";
  return <div className="playbook-status-control"><form action={action} onSubmit={event => { if (!window.confirm(next === "active" ? "Activate this lead playbook? Incoming replies can prepare AI drafts, but cannot send without approval." : "Pause this lead playbook? Existing drafts remain available for review.")) event.preventDefault(); }}><input type="hidden" name="workflow_id" value={id} /><input type="hidden" name="status" value={next} /><Submit idle={next === "active" ? "Activate" : "Pause"} pending="Updating…" tone="secondary" /></form><Feedback state={state} /></div>;
}

function ClientDefinitionFields({ playbook }: { playbook: ClientPlaybook }) {
  return <>
    <label>Playbook name <span>(required)</span><input name="name" minLength={3} maxLength={120} defaultValue={playbook.name} required /></label>
    <label>Purpose <span>(optional)</span><input name="description" maxLength={500} defaultValue={playbook.description} /></label>
    <div className="playbook-modal-fields"><label>Channel<select name="channel" defaultValue={playbook.channel}><option value="email">Email</option><option value="slack">Slack</option></select></label><label>Trigger<select name="trigger_type" defaultValue={playbook.triggerType}><option value="manual_client_checkin">Manual from client page</option><option value="scheduled_checkin">Scheduled check-in</option><option value="stripe_cancellation">Stripe cancellation detected</option><option value="churn_reactivation">Churn reactivation</option></select></label><label>Cooldown in days<input name="cooldown_days" type="number" min={1} max={365} defaultValue={playbook.cooldownDays} /></label></div>
    <fieldset><legend>Relationship types</legend><div className="playbook-status-grid"><label><input type="checkbox" name="eligible_segments" value="lead" defaultChecked={playbook.eligibleSegments.includes("lead")} /><span>Lead</span></label><label><input type="checkbox" name="eligible_segments" value="epsiflow_direct" defaultChecked={playbook.eligibleSegments.includes("epsiflow_direct")} /><span>EpsiFlow Direct</span></label><label><input type="checkbox" name="eligible_segments" value="stripe_plan" defaultChecked={playbook.eligibleSegments.includes("stripe_plan")} /><span>Stripe plan</span></label></div></fieldset>
    <fieldset><legend>Relationship states</legend><div className="playbook-status-grid"><label><input type="checkbox" name="eligible_relationships" value="active" defaultChecked={playbook.eligibleRelationships.includes("active")} /><span>Active</span></label><label><input type="checkbox" name="eligible_relationships" value="churned" defaultChecked={playbook.eligibleRelationships.includes("churned")} /><span>Churned</span></label></div></fieldset>
    <fieldset><legend>Eligible subscription states <span>(empty means any)</span></legend><div className="playbook-status-grid">{statuses.map(status => <label key={status}><input type="checkbox" name="eligible_statuses" value={status} defaultChecked={playbook.eligibleStatuses.includes(status)} /><span>{status.replaceAll("_", " ")}</span></label>)}</div></fieldset>
    <label>Email subject <span>(required for email)</span><input name="subject_template" maxLength={998} defaultValue={playbook.subjectTemplate || ""} /></label>
    <label>Fallback template <span>(required)</span><textarea name="body_template" minLength={1} maxLength={10000} defaultValue={playbook.bodyTemplate} required /></label>
    <label>AI instructions <span>(passed to the model)</span><textarea name="agent_prompt" minLength={20} maxLength={12000} defaultValue={playbook.agentPrompt} required /></label>
  </>;
}

export function PlaybookDetailsModal({ playbook, isAdmin }: { playbook: ManagedPlaybook; isAdmin: boolean }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [clientState, clientAction] = useActionState(updateClientPlaybook, initial);
  const [leadState, leadAction] = useActionState(updateReplyWorkflow, initial);
  const state = playbook.kind === "client" ? clientState : leadState;
  const audience = playbook.kind === "client" ? `${playbook.eligibleSegments.map(value => value.replaceAll("_", " ")).join(", ")} · ${playbook.eligibleRelationships.join(", ")}` : "Active leads who reply to outreach";
  const cadence = playbook.kind === "client" ? `At most once every ${playbook.cooldownDays} days per contact` : `Once per incoming reply, after ${playbook.delayMinutes} minutes`;
  return <>
    <button className="secondary-button compact-button" type="button" onClick={() => dialogRef.current?.showModal()}>View playbook</button>
    <dialog className="playbook-modal" ref={dialogRef} aria-labelledby={`playbook-modal-${playbook.id}`}>
      <div className="playbook-modal-shell"><header><div><p className="eyebrow">{playbook.kind === "lead" ? "Lead response" : "Client success"} · version {playbook.currentVersion}</p><h2 id={`playbook-modal-${playbook.id}`}>{playbook.name}</h2><p>{playbook.description}</p></div><form method="dialog"><button className="icon-button" type="submit" aria-label="Close playbook details"><X size={19} aria-hidden="true" /></button></form></header>
        <div className="playbook-modal-summary"><span><small>Audience</small><strong>{audience}</strong></span><span><small>Recommended cadence</small><strong>{cadence}</strong></span><span><small>Action</small><strong>Prepare {playbook.channel} draft for approval</strong></span></div>
        <section aria-labelledby={`prompt-${playbook.id}`}><div className="playbook-modal-section-heading"><div><p className="eyebrow">Model input</p><h3 id={`prompt-${playbook.id}`}>AI playbook instructions</h3></div><span className="status-badge status-active">Context-aware</span></div><p className="playbook-modal-note">These instructions are passed to the AI together with guarded system rules and the complete synchronized conversation context.</p><pre className="playbook-prompt"><code>{playbook.agentPrompt}</code></pre></section>
        {isAdmin && playbook.status !== "active" ? <section aria-labelledby={`edit-${playbook.id}`}><div className="playbook-modal-section-heading"><div><p className="eyebrow">Editable definition</p><h3 id={`edit-${playbook.id}`}>Create a new immutable version</h3></div></div>{playbook.kind === "client" ? <form className="action-form playbook-modal-form" action={clientAction}><input type="hidden" name="playbook_id" value={playbook.id} /><ClientDefinitionFields playbook={playbook} /><Submit idle="Save new version" pending="Saving version…" /><Feedback state={clientState} /></form> : <form className="action-form playbook-modal-form" action={leadAction}><input type="hidden" name="workflow_id" value={playbook.id} /><label>Playbook name<input name="name" minLength={3} maxLength={120} defaultValue={playbook.name} required /></label><label>Purpose<input name="description" maxLength={500} defaultValue={playbook.description} /></label><label>Draft delay in minutes<input name="delay_minutes" type="number" min={0} max={10080} defaultValue={playbook.delayMinutes} required /></label><label>Fallback reply template<textarea name="body_template" minLength={1} maxLength={10000} defaultValue={playbook.bodyTemplate} required /></label><label>AI instructions <span>(passed to the model)</span><textarea name="agent_prompt" minLength={20} maxLength={12000} defaultValue={playbook.agentPrompt} required /></label><Submit idle="Save new version" pending="Saving version…" /><Feedback state={leadState} /></form>}</section> : <p className="playbook-edit-lock">{isAdmin ? "Pause this playbook before changing its audience, cadence, template, or AI instructions." : "Only organization administrators can edit playbooks."}</p>}
        {state.ok ? <form method="dialog" className="playbook-modal-done"><button className="secondary-button compact-button" type="submit">Close</button></form> : null}
      </div>
    </dialog>
  </>;
}

export function ClientPlaybookRunner({ clientAppId, contacts, playbooks }: { clientAppId: string; contacts: Array<{ id: string; name: string }>; playbooks: Array<{ id: string; name: string; channel: string }> }) {
  const [state, action] = useActionState(createClientPlaybookDraftAction, initial);
  return <form className="action-form client-playbook-runner" action={action}><input type="hidden" name="client_app_id" value={clientAppId} />
    <label>Playbook<select name="playbook_id" required defaultValue=""><option value="" disabled>Select a playbook</option>{playbooks.map(playbook => <option value={playbook.id} key={playbook.id}>{playbook.name} · {playbook.channel}</option>)}</select></label>
    <label>Contact<select name="contact_id" required defaultValue={contacts[0]?.id || ""}>{contacts.map(contact => <option value={contact.id} key={contact.id}>{contact.name}</option>)}</select></label>
    <Submit idle="Prepare draft" pending="Preparing draft…" /><small>No message is sent. The result appears in Approvals for editing and a decision.</small><Feedback state={state} />
  </form>;
}
