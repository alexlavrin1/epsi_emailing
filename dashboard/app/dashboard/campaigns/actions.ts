"use server";

import { revalidatePath } from "next/cache";
import { requireMembership } from "../../../lib/auth";
import { createSupabaseServerClient } from "../../../lib/supabase-server";

export type CampaignActionState = { ok: boolean; message: string };
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function setCampaignStatus(_state: CampaignActionState, formData: FormData): Promise<CampaignActionState> {
  const { membership } = await requireMembership();
  if (!membership) return { ok: false, message: "An active organization membership is required." };
  const campaignId = String(formData.get("campaign_id") || "");
  const status = String(formData.get("status") || "");
  if (!uuidPattern.test(campaignId) || !["active", "paused"].includes(status)) return { ok: false, message: "Invalid campaign action." };
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { ok: false, message: "Unable to update this campaign." };
  const { error } = await supabase.rpc("dashboard_set_campaign_status", {
    target_organization_id: membership.organization.id,
    target_campaign_id: campaignId,
    target_status: status,
  });
  if (error) return { ok: false, message: error.message.includes("Completed campaigns") ? "Completed campaigns cannot be resumed." : "Unable to update this campaign." };
  revalidatePath("/dashboard/campaigns");
  revalidatePath("/dashboard");
  return { ok: true, message: status === "active" ? "Campaign resumed. Scheduled sends may run on the next cycle." : "Campaign paused. Scheduled sends are being held." };
}
