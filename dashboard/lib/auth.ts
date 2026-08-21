import { cache } from "react";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "./supabase-server";

export type DashboardMembership = {
  id: string;
  role: "admin" | "operator";
  status: "active" | "suspended";
  organization: { id: string; name: string; slug: string };
};

export const getCurrentUser = cache(async function getCurrentUser() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getUser();
  return error ? null : data.user;
});

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  return user;
}

export const getMembership = cache(async function getMembership(userId: string): Promise<DashboardMembership | null> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("organization_members")
    .select("id, role, status, organization:organizations(id, name, slug)")
    .eq("user_id", userId)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();
  if (error || !data || !data.organization) return null;
  const organization = Array.isArray(data.organization) ? data.organization[0] : data.organization;
  if (!organization) return null;
  return { id: data.id, role: data.role, status: data.status, organization } as DashboardMembership;
});

export async function requireMembership() {
  const user = await requireUser();
  return { user, membership: await getMembership(user.id) };
}
