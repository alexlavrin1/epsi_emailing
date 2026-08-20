"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";

export function LoginForm({ notice }: { notice?: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: form.get("email"), password: form.get("password") }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(result.error ?? "Sign in failed. Please try again.");
        return;
      }
      window.location.assign("/dashboard");
    } catch {
      setError("The dashboard could not be reached. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="login-form" onSubmit={handleSubmit}>
      <div className="field">
        <label htmlFor="email">Email address</label>
        <input id="email" name="email" type="email" autoComplete="email" placeholder="you@company.com" required />
      </div>
      <div className="field">
        <div className="field-heading">
          <label htmlFor="password">Password</label>
          <Link className="inline-link" href="/forgot-password">Forgot password?</Link>
        </div>
        <input id="password" name="password" type="password" autoComplete="current-password" placeholder="Enter your password" minLength={8} required />
      </div>
      {notice ? <p className="form-success" role="status">{notice}</p> : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <button className="primary-button" type="submit" disabled={pending}>
        {pending ? "Signing in…" : "Sign in securely"}
      </button>
    </form>
  );
}
