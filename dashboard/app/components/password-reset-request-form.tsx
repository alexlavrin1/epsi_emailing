"use client";

import { useState, type FormEvent } from "react";

export function PasswordResetRequestForm() {
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/auth/password-reset", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: form.get("email") }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(result.error ?? "We could not send the email. Please try again.");
        return;
      }
      setSent(true);
    } catch {
      setError("The dashboard could not be reached. Please try again.");
    } finally {
      setPending(false);
    }
  }

  if (sent) {
    return (
      <div className="form-success-panel" role="status">
        <strong>Check your email</strong>
        <p>If an EpsiFlow account exists for that address, a secure password link is on its way.</p>
      </div>
    );
  }

  return (
    <form className="login-form" onSubmit={handleSubmit}>
      <div className="field">
        <label htmlFor="reset-email">Email address</label>
        <input id="reset-email" name="email" type="email" autoComplete="email" placeholder="you@company.com" required />
      </div>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <button className="primary-button" type="submit" disabled={pending}>
        {pending ? "Sending secure link…" : "Send password link"}
      </button>
    </form>
  );
}
