"use client";

import { useState, type FormEvent } from "react";

export function UpdatePasswordForm() {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    const confirmation = String(form.get("password-confirmation") ?? "");
    if (password !== confirmation) {
      setError("The passwords do not match.");
      return;
    }
    setPending(true);
    try {
      const response = await fetch("/api/auth/update-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(result.error ?? "The password could not be updated. Request a new link and try again.");
        return;
      }
      window.location.assign("/?password_updated=1");
    } catch {
      setError("The dashboard could not be reached. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="login-form" onSubmit={handleSubmit}>
      <div className="field">
        <label htmlFor="new-password">New password</label>
        <input id="new-password" name="password" type="password" autoComplete="new-password" minLength={12} required />
        <p className="field-help">Use at least 12 characters.</p>
      </div>
      <div className="field">
        <label htmlFor="password-confirmation">Confirm new password</label>
        <input id="password-confirmation" name="password-confirmation" type="password" autoComplete="new-password" minLength={12} required />
      </div>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <button className="primary-button" type="submit" disabled={pending}>
        {pending ? "Saving password…" : "Create password"}
      </button>
    </form>
  );
}
