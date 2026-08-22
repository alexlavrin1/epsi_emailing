import { redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { MfaForm } from "../components/mfa-form";
import { getMembership, requireUser } from "../../lib/auth";
import { createSupabaseServerClient } from "../../lib/supabase-server";

export const dynamic = "force-dynamic";

export default async function MfaPage() {
  const user = await requireUser();
  const membership = await getMembership(user.id);
  if (!membership) redirect("/dashboard");
  if (membership.role !== "admin") redirect("/dashboard");

  const supabase = await createSupabaseServerClient();
  if (!supabase) redirect("/");
  const [{ data: assurance }, { data: factors }] = await Promise.all([
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    supabase.auth.mfa.listFactors(),
  ]);
  if (assurance?.currentLevel === "aal2") redirect("/dashboard");

  const verifiedFactor = factors?.totp[0];
  return (
    <main className="auth-page" id="main-content">
      <section className="login-card auth-card mfa-card" aria-labelledby="mfa-heading">
        <div className="mfa-icon"><ShieldCheck aria-hidden="true" size={26} /></div>
        <p className="eyebrow auth-eyebrow">Administrator security</p>
        <h1 id="mfa-heading">{verifiedFactor ? "Verify it’s you" : "Protect your account"}</h1>
        <p className="muted">{verifiedFactor
          ? "Enter the six-digit code from your authenticator app to continue to EpsiFlow."
          : "Administrators must use an authenticator app before accessing client and automation data."}</p>
        <MfaForm verifiedFactorId={verifiedFactor?.id ?? null} />
        <form action="/api/auth/logout" method="post"><button className="text-button mfa-signout" type="submit">Sign out</button></form>
      </section>
    </main>
  );
}
