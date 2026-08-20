import { redirect } from "next/navigation";
import Link from "next/link";
import { LoginForm } from "./components/login-form";
import { getCurrentUser } from "../lib/auth";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getCurrentUser();
  if (user) redirect("/dashboard");

  return (
    <main className="login-shell" id="main-content">
      <section className="login-intro" aria-labelledby="login-heading">
        <Link className="brand" href="/" aria-label="EpsiFlow home">
          <span className="brand-mark" aria-hidden="true">E</span>
          <span>EpsiFlow</span>
        </Link>
        <div className="intro-copy">
          <p className="eyebrow">Operations control center</p>
          <h1 id="login-heading">Every client signal, in one secure workspace.</h1>
          <p>Monitor outreach, replies, payment recovery, and automation health without exposing the credentials that power your engine.</p>
        </div>
        <div className="trust-strip" aria-label="Security features">
          <span>Invite-only access</span><span>Organization isolation</span><span>Audited actions</span>
        </div>
      </section>
      <section className="login-panel" aria-label="Sign in">
        <div className="login-card">
          <div className="status-pill"><span /> Protected workspace</div>
          <h2>Welcome back</h2>
          <p className="muted">Sign in with your invited EpsiFlow account.</p>
          <LoginForm />
          <p className="login-note">Accounts are created by an administrator. Contact your workspace owner if you need access.</p>
        </div>
      </section>
    </main>
  );
}
