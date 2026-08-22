"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

type Enrollment = { factorId: string; qrCode: string; secret: string };

export function MfaForm({ verifiedFactorId }: { verifiedFactorId: string | null }) {
  const router = useRouter();
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function enroll() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/mfa/enroll", { method: "POST" });
      const result = (await response.json()) as Enrollment & { error?: string };
      if (!response.ok) return setError(result.error ?? "Authenticator setup failed. Please try again.");
      setEnrollment(result);
    } catch {
      setError("The dashboard could not be reached. Please try again.");
    } finally {
      setPending(false);
    }
  }

  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/auth/mfa/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ factorId: enrollment?.factorId ?? verifiedFactorId, code: form.get("code") }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) return setError(result.error ?? "That code could not be verified.");
      router.replace("/dashboard");
      router.refresh();
    } catch {
      setError("The dashboard could not be reached. Please try again.");
    } finally {
      setPending(false);
    }
  }

  if (!verifiedFactorId && !enrollment) {
    return <div className="mfa-start"><p>Use Google Authenticator, 1Password, Authy, or another TOTP-compatible app.</p><button className="primary-button" type="button" disabled={pending} onClick={enroll}>{pending ? "Preparing…" : "Set up authenticator"}</button>{error ? <p className="form-error" role="alert">{error}</p> : null}</div>;
  }

  return <div className="mfa-setup">
    {enrollment ? <div className="mfa-enrollment">
      <p>Scan this QR code with your authenticator app.</p>
      <div className="mfa-qr"><Image src={enrollment.qrCode} width={188} height={188} unoptimized alt="Authenticator enrollment QR code" /></div>
      <details><summary>Can’t scan the code?</summary><p>Enter this setup key manually:</p><code>{enrollment.secret}</code></details>
    </div> : null}
    <form className="login-form mfa-code-form" onSubmit={verify}>
      <div className="field"><label htmlFor="mfa-code">Six-digit code</label><input id="mfa-code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" minLength={6} maxLength={6} placeholder="000000" required /></div>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <button className="primary-button" type="submit" disabled={pending}>{pending ? "Verifying…" : enrollment ? "Verify and finish setup" : "Verify and continue"}</button>
    </form>
  </div>;
}
