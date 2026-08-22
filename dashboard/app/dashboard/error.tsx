"use client";
import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
export default function DashboardError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { void fetch("/api/monitoring/error", { method: "POST" }).catch(() => undefined); }, []);
  return <main className="dashboard-main" id="main-content"><section className="dashboard-error-card"><AlertTriangle size={28} aria-hidden="true" /><p className="eyebrow">Something went wrong</p><h1>This dashboard view could not load.</h1><p>The failure was recorded using a sanitized code. No page content or client data was included.</p><button className="primary-button" type="button" onClick={reset}>Try again</button></section></main>;
}
