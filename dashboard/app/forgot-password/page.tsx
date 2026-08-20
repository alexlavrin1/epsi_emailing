import type { Metadata } from "next";
import Link from "next/link";
import { PasswordResetRequestForm } from "../components/password-reset-request-form";

export const metadata: Metadata = { title: "Reset password" };

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  return (
    <main className="auth-page" id="main-content">
      <section className="login-card auth-card" aria-labelledby="reset-heading">
        <Link className="brand" href="/" aria-label="Back to EpsiFlow sign in"><span className="brand-mark" aria-hidden="true">E</span><span>EpsiFlow</span></Link>
        <p className="eyebrow auth-eyebrow">Account recovery</p>
        <h1 id="reset-heading">Create your password</h1>
        <p className="muted">Enter your invited email address and we’ll send a secure, time-limited link.</p>
        {params.error ? <p className="form-error standalone-error" role="alert">That password link is invalid or expired. Request a new one below.</p> : null}
        <PasswordResetRequestForm />
        <Link className="back-link" href="/">Back to sign in</Link>
      </section>
    </main>
  );
}
