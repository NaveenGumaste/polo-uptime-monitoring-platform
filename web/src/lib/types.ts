export type MonitorStatus = "UP" | "DOWN" | "PENDING";

export interface Monitor {
  id: string;
  name: string;
  url: string;
  status: MonitorStatus;
  statusCode: number;
  latencyMs: number;
  sslExpiryDays: number;
  lastChecked: string | null;
}

export interface Incident {
  id: number;
  monitor_id: string;
  url: string;
  status_code: number;
  reason: string;
  created_at: string;
}

export interface CheckResult {
  monitorId: string;
  url: string;
  status: MonitorStatus;
  statusCode: number;
  latencyMs: number;
  sslExpiryDays: number;
  checkedAt: string;
}
