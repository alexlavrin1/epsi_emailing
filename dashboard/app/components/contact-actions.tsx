"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Check, ClipboardCheck, FileText, Save } from "lucide-react";
import type { ContactActionData, LifecycleStage } from "../../lib/dashboard-data";
import { addContactNote, createContactTask, setContactTaskStatus, setLifecycleStage, type ContactActionState } from "../dashboard/crm/[kind]/[id]/actions";

const initialState: ContactActionState = { ok: false, message: "" };
const stages: Array<{ value: LifecycleStage; label: string }> = [
  { value: "prospect", label: "Prospect" },
  { value: "interested", label: "Interested" },
  { value: "client", label: "Client" },
  { value: "at_risk", label: "At risk" },
  { value: "suppressed", label: "Suppressed" },
];

function SubmitButton({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return <button className="secondary-button compact-button" disabled={pending} type="submit">{pending ? "Saving…" : children}</button>;
}

function Feedback({ state }: { state: ContactActionState }) {
  if (!state.message) return null;
  return <p className={state.ok ? "action-feedback success" : "action-feedback error"} role={state.ok ? "status" : "alert"}>{state.message}</p>;
}

export function ContactActions({ kind, id, currentStage, data }: { kind: "prospect" | "customer"; id: string; currentStage: LifecycleStage; data: ContactActionData }) {
  const [stageState, stageAction] = useActionState(setLifecycleStage, initialState);
  const [noteState, noteAction] = useActionState(addContactNote, initialState);
  const [taskState, taskAction] = useActionState(createContactTask, initialState);
  const [taskStatusState, taskStatusAction] = useActionState(setContactTaskStatus, initialState);
  const selectedStage = data.lifecycleStage ?? currentStage;

  if (!data.ready) return <section className="panel setup-panel"><Save size={20} aria-hidden="true" /><div><strong>Operator actions are ready to install</strong><p>Apply migration 007 to enable audited lifecycle changes, notes, and tasks. Existing CRM data remains read-only.</p></div></section>;

  return (
    <section className="contact-actions-grid" aria-label="Contact actions">
      <article className="panel action-panel">
        <div className="action-heading"><span className="card-icon"><Save size={17} aria-hidden="true" /></span><div><h2>Lifecycle stage</h2><p>Manual changes override the computed pipeline stage.</p></div></div>
        <form action={stageAction} className="action-form">
          <input type="hidden" name="kind" value={kind} /><input type="hidden" name="id" value={id} />
          <label htmlFor="lifecycle-stage">Stage</label><select id="lifecycle-stage" name="stage" defaultValue={selectedStage}>{stages.map(stage => <option value={stage.value} key={stage.value}>{stage.label}</option>)}</select>
          <SubmitButton>Save stage</SubmitButton><Feedback state={stageState} />
        </form>
      </article>

      <article className="panel action-panel">
        <div className="action-heading"><span className="card-icon"><FileText size={17} aria-hidden="true" /></span><div><h2>Add note</h2><p>Keep internal context attached to this contact.</p></div></div>
        <form action={noteAction} className="action-form">
          <input type="hidden" name="kind" value={kind} /><input type="hidden" name="id" value={id} />
          <label htmlFor="contact-note">Note</label><textarea id="contact-note" name="body" maxLength={4000} required rows={4} placeholder="Add useful context for the team…" />
          <SubmitButton>Add note</SubmitButton><Feedback state={noteState} />
        </form>
      </article>

      <article className="panel action-panel">
        <div className="action-heading"><span className="card-icon"><ClipboardCheck size={17} aria-hidden="true" /></span><div><h2>Create task</h2><p>Add an owned follow-up with an optional due date.</p></div></div>
        <form action={taskAction} className="action-form">
          <input type="hidden" name="kind" value={kind} /><input type="hidden" name="id" value={id} />
          <label htmlFor="task-title">Task title</label><input id="task-title" name="title" maxLength={200} required placeholder="Follow up with client" />
          <label htmlFor="task-due-date">Due date <span>(optional)</span></label><input id="task-due-date" name="due_date" type="date" />
          <SubmitButton>Create task</SubmitButton><Feedback state={taskState} />
        </form>
      </article>

      <article className="panel action-records">
        <div className="panel-heading"><div><p className="eyebrow">Team context</p><h2>Notes and tasks</h2></div><span className="count-badge">{data.notes.length + data.tasks.length}</span></div>
        {data.tasks.length ? <div className="task-list"><h3>Tasks</h3>{data.tasks.map(task => <div className={`task-row ${task.status}`} key={task.id}><span className="task-check" aria-hidden="true">{task.status === "completed" ? <Check size={14} /> : null}</span><span><strong>{task.title}</strong><small>{task.dueAt ? `Due ${new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(new Date(task.dueAt))}` : "No due date"}</small></span><form action={taskStatusAction}><input type="hidden" name="kind" value={kind} /><input type="hidden" name="id" value={id} /><input type="hidden" name="task_id" value={task.id} /><input type="hidden" name="status" value={task.status === "completed" ? "open" : "completed"} /><SubmitButton>{task.status === "completed" ? "Reopen" : "Complete"}</SubmitButton></form></div>)}</div> : null}
        {data.notes.length ? <div className="note-list"><h3>Notes</h3>{data.notes.map(note => <article key={note.id}><p>{note.body}</p><time dateTime={note.createdAt}>{new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(note.createdAt))}</time></article>)}</div> : null}
        {!data.notes.length && !data.tasks.length ? <div className="empty-state action-empty"><ClipboardCheck size={22} aria-hidden="true" /><strong>No notes or tasks yet</strong><p>Add the first piece of operational context above.</p></div> : null}
        <Feedback state={taskStatusState} />
      </article>
    </section>
  );
}
