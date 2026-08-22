"use server";
import { revalidatePath } from "next/cache";
import { requireMembership } from "../../../lib/auth";
import { createSupabaseServerClient } from "../../../lib/supabase-server";
export type RetentionActionState = { ok: boolean; message: string };
const categories = new Set(["automation_history", "worker_monitoring", "email_content", "crm_notes", "audit_history"]);
export async function setRetentionPeriod(_state: RetentionActionState, formData: FormData): Promise<RetentionActionState> {
  const { membership } = await requireMembership();
  if (!membership || membership.role !== "admin") return { ok: false, message: "Administrator access is required." };
  const category = String(formData.get("category") || ""); const days = Number(formData.get("retention_days"));
  if (!categories.has(category) || !Number.isInteger(days) || days < 30 || days > 3650 || (category === "audit_history" && days < 365)) return { ok: false, message: "Enter a valid retention period." };
  const supabase = await createSupabaseServerClient(); if (!supabase) return { ok: false, message: "Dashboard authentication is unavailable." };
  const { error } = await supabase.rpc("dashboard_set_retention_period", { target_organization_id: membership.organization.id, target_category: category, target_retention_days: days });
  if (error) return { ok: false, message: /schema cache|does not exist|Could not find/i.test(error.message) ? "Retention controls require migration 022." : "The retention period could not be updated." };
  revalidatePath("/dashboard/data-governance"); revalidatePath("/dashboard/audit");
  return { ok: true, message: "Draft retention period updated. No records were deleted." };
}
