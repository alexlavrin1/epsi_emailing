"use server";

import { revalidatePath } from "next/cache";
import { requireMembership } from "../../../lib/auth";
import { createSupabaseServerClient } from "../../../lib/supabase-server";
import type { LifecycleStage, PipelineContact } from "../../../lib/dashboard-data";

export type PipelineMoveResult = { ok: boolean; message: string };

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const stages = new Set<LifecycleStage>(["prospect", "interested", "client", "at_risk", "churned", "suppressed"]);
const kinds = new Set<PipelineContact["kind"]>(["prospect", "customer", "client"]);

export async function movePipelineRecord(kind: PipelineContact["kind"], id: string, stage: LifecycleStage): Promise<PipelineMoveResult> {
  const { membership } = await requireMembership();
  if (!membership) return { ok: false, message: "An active workspace membership is required." };
  if (!kinds.has(kind) || !uuidPattern.test(id) || !stages.has(stage)) return { ok: false, message: "That pipeline move is not valid." };
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { ok: false, message: "Pipeline controls are unavailable." };
  const { error } = await supabase.rpc("dashboard_set_lifecycle_stage", {
    target_organization_id: membership.organization.id,
    target_contact_kind: kind === "client" ? "client_app" : kind,
    target_contact_id: id,
    target_stage: stage,
  });
  if (error) {
    if (/schema cache|Could not find|does not exist|Invalid lifecycle stage|Contact not found/i.test(error.message)) {
      return { ok: false, message: "Drag-and-drop stages require database migration 048." };
    }
    if (/Not authorized/i.test(error.message)) return { ok: false, message: "Your workspace access changed. Refresh and try again." };
    return { ok: false, message: "The customer could not be moved. Refresh and try again." };
  }
  revalidatePath("/dashboard/pipeline");
  revalidatePath("/dashboard/crm");
  revalidatePath("/dashboard/clients");
  revalidatePath("/dashboard/audit");
  return { ok: true, message: "Pipeline stage updated." };
}
