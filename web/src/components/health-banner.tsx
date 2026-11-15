import { Check, Radio, TriangleAlert } from "lucide-react";
import type { Monitor } from "@/lib/types";

function healthSummary(monitors: Monitor[], connected: boolean, loading: boolean) {
  const down = monitors.filter((monitor) => monitor.status === "DOWN").length;
  const up = monitors.filter((monitor) => monitor.status === "UP").length;
  const pending = monitors.filter((monitor) => monitor.status === "PENDING").length;
  if (!connected) return { title: loading ? "Getting a pulse on your services" : "Ready when you are", detail: "Your latest service health will appear here.", state: "waiting" };
  if (down) return { title: `${down} ${down === 1 ? "monitor needs" : "monitors need"} your attention`, detail: `${up} operational${pending ? ` · ${pending} pending` : ""}. Check the affected services below.`, state: "warning" };
  if (!monitors.length) return { title: "A fresh start for your uptime", detail: "Add a monitor to bring your services into view.", state: "waiting" };
  if (pending) return { title: "Waiting for the full picture", detail: `${pending} ${pending === 1 ? "monitor is" : "monitors are"} awaiting a first check.`, state: "waiting" };
  return { title: "All systems operational", detail: "Everything is looking good. We’ll keep an eye on it.", state: "healthy" };
}

export function HealthBanner({ monitors, connected, loading }: { monitors: Monitor[]; connected: boolean; loading: boolean }) {
  const summary = healthSummary(monitors, connected, loading);
  const Icon = summary.state === "warning" ? TriangleAlert : summary.state === "healthy" ? Check : Radio;
  return <div className={`health-banner ${summary.state === "warning" ? "health-warning" : ""}`} aria-live="polite"><span className="health-icon"><Icon size={20} /></span><div><strong>{summary.title}</strong><p>{summary.detail}</p></div><span className="health-label"><span className="status-dot" />{connected ? "CURRENT STATUS" : "NOT CONNECTED"}</span></div>;
}
