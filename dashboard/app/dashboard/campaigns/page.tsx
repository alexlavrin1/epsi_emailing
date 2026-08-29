import type { Metadata } from "next";
import { CalendarClock, CircleStop, Mail, Megaphone, PauseCircle, PlayCircle, ShieldCheck } from "lucide-react";
import { CampaignControls } from "../../components/campaign-controls";
import { requireMembership } from "../../../lib/auth";
import { createSupabaseServerClient } from "../../../lib/supabase-server";
import { formatWhen, getCampaigns, getOutreachControlsReady, getPaymentRecoveryCampaignStats } from "../../../lib/dashboard-data";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Campaign controls" };

const recoverySequence = [
  { day: 0, label: "Incomplete invoice", subject: "EpsiFlow: Invoice payment incomplete", purpose: "Notify the customer and provide the secure Stripe authentication link." },
  { day: 2, label: "Payment reminder", subject: "Reminder: EpsiFlow payment action required", purpose: "Follow up on the first email and repeat the payment action." },
  { day: 5, label: "Issue discovery", subject: "Can we help with your EpsiFlow payment?", purpose: "Ask what is blocking the customer and invite a direct reply." },
  { day: 9, label: "Soft warning", subject: "EpsiFlow: Please respond to avoid card interruption", purpose: "Warn that no payment or response will require the card to be blocked." },
  { day: 14, label: "Three-day notice", subject: "EpsiFlow: Your card will be blocked in 3 days", purpose: "Give the final three-day notice before the card is blocked." },
] as const;

export default async function CampaignsPage() {
  const { membership } = await requireMembership();
  if (!membership) return null;
  const supabase = await createSupabaseServerClient();
  if (!supabase) throw new Error("Dashboard authentication is not configured.");
  const [campaigns, controlsReady, recoveryStats] = await Promise.all([
    getCampaigns(supabase, membership.organization.id),
    getOutreachControlsReady(supabase),
    getPaymentRecoveryCampaignStats(supabase),
  ]);
  return <main className="dashboard-main" id="main-content">
    <header className="page-header"><div><p className="eyebrow">Audited controls</p><h1>Campaigns</h1><p className="page-summary">Review automated sequences, pause outreach, or resume scheduled sends on the next eligible cycle.</p></div><span className="record-count">{campaigns.length + 1} campaigns</span></header>
    <section className="recovery-campaign" aria-labelledby="recovery-campaign-title">
      <header className="recovery-campaign-header">
        <div className="recovery-campaign-title"><span className="campaign-state-icon active" aria-hidden="true"><ShieldCheck size={20} /></span><div><span className="status-badge status-active">automatic</span><h2 id="recovery-campaign-title">Incomplete invoice recovery</h2><p><CalendarClock size={13} aria-hidden="true" />14 days · 5 emails · final three-day notice</p></div></div>
        <dl className="recovery-campaign-metrics"><div><dt>Open cases</dt><dd>{recoveryStats.openCases}</dd></div><div><dt>Scheduled</dt><dd>{recoveryStats.scheduledEmails}</dd></div><div><dt>Sent</dt><dd>{recoveryStats.sentEmails}</dd></div></dl>
      </header>
      <ol className="recovery-sequence" aria-label="Five-email payment recovery sequence">
        {recoverySequence.map((step, index) => <li className={index >= 3 ? "warning-step" : ""} key={step.day}><span className="sequence-day">Day {step.day}</span><span className="sequence-number" aria-hidden="true">{index + 1}</span><div><h3>{step.label}</h3><strong>{step.subject}</strong><p>{step.purpose}</p></div></li>)}
      </ol>
      <footer className="recovery-campaign-safeguard"><CircleStop size={15} aria-hidden="true" /><span><strong>Automatic stop:</strong> Stripe and synchronized replies are checked before every step. Paying or replying cancels all remaining emails.</span></footer>
    </section>
    {!controlsReady ? <section className="panel setup-panel"><PauseCircle size={20} aria-hidden="true" /><div><strong>Campaign controls are ready to install</strong><p>Apply migration 008 to activate audited pause, resume, and contact-level stop actions.</p></div></section> : null}
    {campaigns.length ? <section className="campaign-list" aria-label="Campaigns">{campaigns.map(campaign => <article className="campaign-card" key={campaign.id}><div className={`campaign-state-icon ${campaign.status}`} aria-hidden="true">{campaign.status === "active" ? <PlayCircle size={20} /> : <PauseCircle size={20} />}</div><div className="campaign-identity"><span className={`status-badge status-${campaign.status}`}>{campaign.status}</span><h2>{campaign.name}</h2><p><Mail size={13} aria-hidden="true" />{campaign.mailbox} · updated {formatWhen(campaign.updatedAt)}</p></div><dl className="campaign-metrics"><div><dt>Steps</dt><dd>{campaign.steps}</dd></div><div><dt>Scheduled</dt><dd>{campaign.scheduled}</dd></div><div><dt>Sent</dt><dd>{campaign.sent}</dd></div><div><dt>Replies</dt><dd>{campaign.replied}</dd></div></dl><CampaignControls campaign={campaign} ready={controlsReady} /></article>)}</section> : <div className="empty-state large-empty"><Megaphone size={28} aria-hidden="true" /><strong>No campaigns found</strong><p>Campaigns created by the outreach engine will appear here.</p></div>}
  </main>;
}
