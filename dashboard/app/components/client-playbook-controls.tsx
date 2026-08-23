"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { createClientPlaybook, setClientPlaybookStatus, type PlaybookActionState } from "../dashboard/playbooks/actions";
import { createClientPlaybookDraftAction } from "../dashboard/clients/actions";

const initial: PlaybookActionState = { ok: false, message: "" };
function Submit({ idle, pending, tone = "primary" }: { idle: string; pending: string; tone?: "primary" | "secondary" }) { const status = useFormStatus(); return <button className={`${tone}-button compact-button`} type="submit" disabled={status.pending}>{status.pending ? pending : idle}</button>; }
function Feedback({ state }: { state: PlaybookActionState }) { return state.message ? <p className={state.ok ? "action-feedback success" : "action-feedback error"} role={state.ok ? "status" : "alert"}>{state.message}</p> : null; }

const statuses = ["active","trialing","past_due","unpaid","incomplete","incomplete_expired","canceled","paused","none"];
const defaultBody = "Hi {{contactFirstName}},\n\nI wanted to check in and see how things are going with {{clientName}}. How are the ads performing, and is there anything you would like us to review or help improve?\n\nBest,\nEpsiFlow";

export function ClientPlaybookBuilder({ isAdmin }: { isAdmin: boolean }) {
  const [state, action] = useActionState(createClientPlaybook, initial);
  if (!isAdmin) return <p className="workflow-role-note">Only organization administrators can create or activate playbooks.</p>;
  return <form className="action-form playbook-builder" action={action}>
    <label>Playbook name <span>(required)</span><input name="name" minLength={3} maxLength={120} defaultValue="Advertising progress check-in" required /></label>
    <label>Purpose <span>(optional)</span><input name="description" maxLength={500} defaultValue="Prepare a friendly client-success check-in about advertising performance and support needs." /></label>
    <label>Channel <span>(required)</span><select name="channel" defaultValue="email"><option value="email">Email</option><option value="slack">Slack</option></select></label>
    <fieldset><legend>Eligible subscription states <span>(leave empty for any state)</span></legend><div className="playbook-status-grid">{statuses.map(status => <label key={status}><input type="checkbox" name="eligible_statuses" value={status} defaultChecked={["active","trialing"].includes(status)} /><span>{status.replaceAll("_", " ")}</span></label>)}</div></fieldset>
    <label>Email subject <span>(required for email)</span><input name="subject_template" maxLength={998} defaultValue="How are things going with {{clientName}}?" /></label>
    <label>Message template <span>(required)</span><textarea name="body_template" minLength={1} maxLength={10000} defaultValue={defaultBody} required /></label>
    <p className="workflow-variable-help">Variables: <code>{"{{clientName}}"}</code> <code>{"{{contactName}}"}</code> <code>{"{{contactFirstName}}"}</code> <code>{"{{subscriptionStatus}}"}</code> <code>{"{{productName}}"}</code> <code>{"{{billingInterval}}"}</code></p>
    <Submit idle="Save draft playbook" pending="Saving playbook…" /><Feedback state={state} />
  </form>;
}

export function ClientPlaybookStatusControl({ id, status }: { id: string; status: string }) {
  const [state, action] = useActionState(setClientPlaybookStatus, initial); const next = status === "active" ? "paused" : "active";
  return <div className="playbook-status-control"><form action={action} onSubmit={event => { if (!window.confirm(next === "active" ? "Activate this playbook? It can prepare drafts, but cannot send them." : "Pause this playbook? Existing drafts remain available for review.")) event.preventDefault(); }}><input type="hidden" name="playbook_id" value={id} /><input type="hidden" name="status" value={next} /><Submit idle={next === "active" ? "Activate" : "Pause"} pending="Updating…" tone="secondary" /></form><Feedback state={state} /></div>;
}

export function ClientPlaybookRunner({ clientAppId, contacts, playbooks }: { clientAppId: string; contacts: Array<{ id: string; name: string }>; playbooks: Array<{ id: string; name: string; channel: string }> }) {
  const [state, action] = useActionState(createClientPlaybookDraftAction, initial);
  return <form className="action-form client-playbook-runner" action={action}><input type="hidden" name="client_app_id" value={clientAppId} />
    <label>Playbook<select name="playbook_id" required defaultValue=""><option value="" disabled>Select a playbook</option>{playbooks.map(playbook => <option value={playbook.id} key={playbook.id}>{playbook.name} · {playbook.channel}</option>)}</select></label>
    <label>Contact<select name="contact_id" required defaultValue={contacts[0]?.id || ""}>{contacts.map(contact => <option value={contact.id} key={contact.id}>{contact.name}</option>)}</select></label>
    <Submit idle="Prepare draft" pending="Preparing draft…" /><small>No message is sent. The result appears in Approvals for editing and a decision.</small><Feedback state={state} />
  </form>;
}

