"use server";
import { revalidatePath } from "next/cache";
import { requireMembership } from "../../../lib/auth";
import { createSupabaseServerClient } from "../../../lib/supabase-server";
export type MonitoringActionState = { ok: boolean; message: string };
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export async function acknowledgeApplicationError(_state: MonitoringActionState, formData: FormData): Promise<MonitoringActionState> {
  const { membership } = await requireMembership(); if (!membership) return { ok: false, message: "An active membership is required." };
  const eventId = String(formData.get("event_id") || ""); if (!uuidPattern.test(eventId)) return { ok: false, message: "Invalid monitoring event." };
  const supabase = await createSupabaseServerClient(); if (!supabase) return { ok: false, message: "Monitoring is unavailable." };
  const { error } = await supabase.rpc("dashboard_acknowledge_application_error", { target_event_id: eventId });
  if (error) return { ok: false, message: /schema cache|does not exist|Could not find/i.test(error.message) ? "Production monitoring requires migration 023." : "The issue could not be acknowledged." };
  revalidatePath("/dashboard/monitoring"); revalidatePath("/dashboard/audit");
  return { ok: true, message: "Issue acknowledged. A recurrence will reopen it." };
}
