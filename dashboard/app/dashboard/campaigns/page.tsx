import type { Metadata } from "next";
import { Mail, Megaphone, PauseCircle, PlayCircle } from "lucide-react";
import { CampaignControls } from "../../components/campaign-controls";
import { requireMembership } from "../../../lib/auth";
import { createSupabaseServerClient } from "../../../lib/supabase-server";
import { formatWhen, getCampaigns, getOutreachControlsReady } from "../../../lib/dashboard-data";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Campaign controls" };

export default async function CampaignsPage() {
  const { membership } = await requireMembership();
  if (!membership) return null;
  const supabase = await createSupabaseServerClient();
  if (!supabase) throw new Error("Dashboard authentication is not configured.");
  const [campaigns, controlsReady] = await Promise.all([getCampaigns(supabase, membership.organization.id), getOutreachControlsReady(supabase)]);
  return <main className="dashboard-main" id="main-content">
    <header className="page-header"><div><p className="eyebrow">Audited controls</p><h1>Outreach campaigns</h1><p className="page-summary">Pause delivery immediately or resume scheduled sends on the next eligible outreach cycle.</p></div><span className="record-count">{campaigns.length} campaigns</span></header>
    {!controlsReady ? <section className="panel setup-panel"><PauseCircle size={20} aria-hidden="true" /><div><strong>Campaign controls are ready to install</strong><p>Apply migration 008 to activate audited pause, resume, and contact-level stop actions.</p></div></section> : null}
    {campaigns.length ? <section className="campaign-list" aria-label="Campaigns">{campaigns.map(campaign => <article className="campaign-card" key={campaign.id}><div className={`campaign-state-icon ${campaign.status}`} aria-hidden="true">{campaign.status === "active" ? <PlayCircle size={20} /> : <PauseCircle size={20} />}</div><div className="campaign-identity"><span className={`status-badge status-${campaign.status}`}>{campaign.status}</span><h2>{campaign.name}</h2><p><Mail size={13} aria-hidden="true" />{campaign.mailbox} · updated {formatWhen(campaign.updatedAt)}</p></div><dl className="campaign-metrics"><div><dt>Steps</dt><dd>{campaign.steps}</dd></div><div><dt>Scheduled</dt><dd>{campaign.scheduled}</dd></div><div><dt>Sent</dt><dd>{campaign.sent}</dd></div><div><dt>Replies</dt><dd>{campaign.replied}</dd></div></dl><CampaignControls campaign={campaign} ready={controlsReady} /></article>)}</section> : <div className="empty-state large-empty"><Megaphone size={28} aria-hidden="true" /><strong>No campaigns found</strong><p>Campaigns created by the outreach engine will appear here.</p></div>}
  </main>;
}
