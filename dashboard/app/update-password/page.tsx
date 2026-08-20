import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { UpdatePasswordForm } from "../components/update-password-form";
import { getCurrentUser } from "../../lib/auth";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Create password" };

export default async function UpdatePasswordPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/forgot-password?error=session");
  return (
    <main className="auth-page" id="main-content">
      <section className="login-card auth-card" aria-labelledby="password-heading">
        <div className="brand"><span className="brand-mark" aria-hidden="true">E</span><span>EpsiFlow</span></div>
        <p className="eyebrow auth-eyebrow">Secure account</p>
        <h1 id="password-heading">Choose a new password</h1>
        <p className="muted">This password will be used to access the private EpsiFlow dashboard.</p>
        <UpdatePasswordForm />
      </section>
    </main>
  );
}
