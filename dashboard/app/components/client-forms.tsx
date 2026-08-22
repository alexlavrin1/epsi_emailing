"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { addClientContactAction, createClientAppAction, initialClientActionState, requestClientSlackAction } from "../dashboard/clients/actions";

function Submit({ idle, pending }: { idle: string; pending: string }) {
  const status = useFormStatus();
  return <button className="primary-button compact-button" disabled={status.pending} type="submit">{status.pending ? pending : idle}</button>;
}

function Feedback({ state }: { state: typeof initialClientActionState }) {
  return state.message ? <p className={state.ok ? "action-feedback success" : "action-feedback error"} role={state.ok ? "status" : "alert"}>{state.message}</p> : null;
}

export function ClientCreateForm() {
  const [state, action] = useActionState(createClientAppAction, initialClientActionState);
  return <form className="client-create-form action-form" action={action}>
    <label htmlFor="client-app-name">App name<input id="client-app-name" name="name" maxLength={160} placeholder="Acme Analytics" required /></label>
    <label htmlFor="client-website">Website<input id="client-website" name="website_url" type="url" maxLength={2048} placeholder="https://acme.example" required /></label>
    <label htmlFor="client-contact-name">Primary contact<input id="client-contact-name" name="contact_name" maxLength={160} placeholder="Sam Rivera" required /></label>
    <label htmlFor="client-contact-email">Email<input id="client-contact-email" name="email" type="email" autoComplete="email" maxLength={320} placeholder="sam@acme.example" required /></label>
    <label htmlFor="client-contact-slack">Slack name <span>(optional)</span><input id="client-contact-slack" name="slack_name" maxLength={120} placeholder="@sam or Sam Rivera" /></label>
    <div className="client-form-submit"><Submit idle="Add existing client" pending="Adding client…" /><small>Email matching starts automatically. Adding a Slack name queues a secure DM assignment.</small></div>
    <Feedback state={state} />
  </form>;
}

export function ClientContactForm({ clientAppId }: { clientAppId: string }) {
  const [state, action] = useActionState(addClientContactAction, initialClientActionState);
  return <form className="client-contact-form action-form" action={action}>
    <input type="hidden" name="client_app_id" value={clientAppId} />
    <label htmlFor="new-contact-name">Contact name<input id="new-contact-name" name="name" maxLength={160} required /></label>
    <label htmlFor="new-contact-email">Email<input id="new-contact-email" name="email" type="email" autoComplete="email" maxLength={320} required /></label>
    <label htmlFor="new-contact-slack">Slack name <span>(optional)</span><input id="new-contact-slack" name="slack_name" maxLength={120} placeholder="@handle or display name" /></label>
    <Submit idle="Add contact" pending="Adding contact…" />
    <Feedback state={state} />
  </form>;
}

export function ClientSlackAssignment({ clientAppId, contactId, slackName, status }: { clientAppId: string; contactId: string; slackName: string | null; status: string }) {
  const [state, action] = useActionState(requestClientSlackAction, initialClientActionState);
  return <form className="client-slack-form" action={action}>
    <input type="hidden" name="client_app_id" value={clientAppId} /><input type="hidden" name="contact_id" value={contactId} />
    <label htmlFor={`slack-name-${contactId}`}>Slack name<input id={`slack-name-${contactId}`} name="slack_name" defaultValue={slackName || ""} maxLength={120} placeholder="@handle or display name" required /></label>
    <Submit idle={status === "failed" ? "Retry chat assignment" : "Assign Slack chat"} pending="Queueing…" />
    <Feedback state={state} />
  </form>;
}
