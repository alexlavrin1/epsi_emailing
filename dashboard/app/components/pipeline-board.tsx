"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, CircleDollarSign, GripVertical } from "lucide-react";
import { useOptimistic, useState, useTransition, type DragEvent } from "react";
import type { LifecycleStage, PipelineContact, PipelineStage } from "../../lib/dashboard-data";
import { movePipelineRecord } from "../dashboard/pipeline/actions";

const stageOptions: Array<{ value: LifecycleStage; label: string }> = [
  { value: "prospect", label: "Prospect" },
  { value: "interested", label: "Interested" },
  { value: "client", label: "Client" },
  { value: "at_risk", label: "At risk" },
  { value: "churned", label: "Churned" },
  { value: "suppressed", label: "Suppressed" },
];

function formatWhen(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.getTime() === 0) return "No activity yet";
  return new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(date);
}

function stageValue(contacts: PipelineContact[]) {
  const totals = new Map<string, number>();
  const counted = new Set<string>();
  for (const contact of contacts) {
    const contributor = `${contact.kind}:${contact.id}`;
    if (!contact.monthlyValue || counted.has(contributor)) continue;
    counted.add(contributor);
    totals.set(contact.monthlyValue.currency, (totals.get(contact.monthlyValue.currency) ?? 0) + contact.monthlyValue.amount);
  }
  if (!totals.size) return "0 linked monthly value";
  return [...totals.entries()].map(([currency, amount]) => {
    try {
      return new Intl.NumberFormat("en", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount / 100);
    } catch {
      return `${(amount / 100).toLocaleString()} ${currency}`;
    }
  }).join(" + ") + " / mo";
}

function sameRecord(left: PipelineContact, right: PipelineContact) {
  return left.kind === right.kind && left.id === right.id;
}

export function PipelineBoard({ stages }: { stages: PipelineStage[] }) {
  const router = useRouter();
  const [columns, setOptimisticMove] = useOptimistic(stages, (current, update: { contact: PipelineContact; targetStage: LifecycleStage }) => current.map(stage => {
    const remaining = stage.contacts.filter(item => !sameRecord(item, update.contact));
    if (stage.id !== update.targetStage) return { ...stage, contacts: remaining };
    const moving = current.flatMap(item => item.contacts).filter(item => sameRecord(item, update.contact)).map(item => ({ ...item, stage: update.targetStage }));
    return { ...stage, contacts: [...moving, ...remaining] };
  }));
  const [dragged, setDragged] = useState<PipelineContact | null>(null);
  const [dropStage, setDropStage] = useState<LifecycleStage | null>(null);
  const [feedback, setFeedback] = useState("");
  const [pending, startTransition] = useTransition();

  function move(contact: PipelineContact, targetStage: LifecycleStage) {
    if (pending || contact.stage === targetStage) return;
    setFeedback("");
    startTransition(async () => {
      setOptimisticMove({ contact, targetStage });
      const result = await movePipelineRecord(contact.kind, contact.id, targetStage);
      setFeedback(result.message);
      if (result.ok) router.refresh();
    });
  }

  function startDrag(event: DragEvent<HTMLButtonElement>, contact: PipelineContact) {
    if (pending) return;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", contact.key);
    setDragged(contact);
    setFeedback(`Moving ${contact.company}. Drop it in another stage.`);
  }

  function drop(event: DragEvent<HTMLElement>, targetStage: LifecycleStage) {
    event.preventDefault();
    if (dragged) move(dragged, targetStage);
    setDragged(null);
    setDropStage(null);
  }

  return <>
    <p className="pipeline-instructions" id="pipeline-drag-help">Drag a customer by its handle, or use the stage menu on any card. Changes are saved and added to the audit log.</p>
    <section className="pipeline-summary" aria-label="Lifecycle stage counts and monthly values">
      {columns.map(stage => <article key={stage.id}><span className={`stage-signal stage-${stage.id}`} aria-hidden="true" /><div><strong>{stage.contacts.length}</strong><span>{stage.label}</span><small>{stageValue(stage.contacts)}</small></div></article>)}
    </section>

    <section className={`pipeline-grid${pending ? " pipeline-updating" : ""}`} aria-label="Contact lifecycle pipeline" aria-busy={pending}>
      {columns.map(stage => (
        <article
          className={`pipeline-column${dropStage === stage.id && dragged?.stage !== stage.id ? " pipeline-drop-target" : ""}`}
          key={stage.id}
          onDragEnter={event => { event.preventDefault(); setDropStage(stage.id); }}
          onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; setDropStage(stage.id); }}
          onDrop={event => drop(event, stage.id)}
        >
          <header><div><span className={`stage-signal stage-${stage.id}`} aria-hidden="true" /><h2>{stage.label}</h2></div><span className="count-badge">{stage.contacts.length}</span><p>{stage.description}</p><strong className="pipeline-stage-value"><CircleDollarSign size={13} aria-hidden="true" />{stageValue(stage.contacts)}</strong></header>
          {stage.contacts.length ? <ol>{stage.contacts.slice(0, 12).map(contact => <li className={`pipeline-card${dragged && sameRecord(dragged, contact) ? " is-dragging" : ""}`} key={contact.key}>
            <Link href={contact.href}><span className="pipeline-card-heading"><strong>{contact.name}</strong><ArrowRight size={15} aria-hidden="true" /></span><span>{contact.company}</span><small>{contact.channels} · {formatWhen(contact.lastActivity)}</small></Link>
            <div className="pipeline-card-controls">
              <button className="pipeline-drag-handle" draggable={!pending} disabled={pending} onDragStart={event => startDrag(event, contact)} onDragEnd={() => { setDragged(null); setDropStage(null); }} aria-describedby="pipeline-drag-help" aria-label={`Drag ${contact.company} to another stage`} title="Drag to another stage"><GripVertical size={15} aria-hidden="true" /></button>
              <label><span className="sr-only">Move {contact.company} to stage</span><select value={stage.id} disabled={pending} onChange={event => move(contact, event.target.value as LifecycleStage)} aria-label={`Move ${contact.company} to stage`}>{stageOptions.map(option => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label>
            </div>
          </li>)}</ol> : <div className={`pipeline-empty${dropStage === stage.id ? " active" : ""}`}>{dropStage === stage.id ? "Drop customer here" : "No contacts in this stage"}</div>}
          {stage.contacts.length > 12 ? <Link className="pipeline-more" href={["client", "at_risk", "churned"].includes(stage.id) ? "/dashboard/clients" : "/dashboard/crm"}>View {stage.contacts.length - 12} more records</Link> : null}
        </article>
      ))}
    </section>
    <p className="pipeline-feedback" role="status" aria-live="polite">{feedback}</p>
  </>;
}
