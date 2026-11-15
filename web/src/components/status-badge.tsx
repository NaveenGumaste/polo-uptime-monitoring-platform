import type { MonitorStatus } from "@/lib/types";

export function StatusBadge({ status }: { status: MonitorStatus }) {
  return <span className={`status-badge status-${status.toLowerCase()}`}><span className="status-dot" />{status === "UP" ? "Operational" : status === "DOWN" ? "Down" : "Pending"}</span>;
}
