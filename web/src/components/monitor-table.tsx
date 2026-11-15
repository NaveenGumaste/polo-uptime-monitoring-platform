"use client";

import { useState } from "react";
import { ArrowUpRight, Globe2, LoaderCircle, Search, ShieldCheck, Trash2, Radio } from "lucide-react";
import { StatusBadge } from "./status-badge";
import { api } from "@/lib/api";
import type { Monitor, MonitorStatus } from "@/lib/types";

const dateFormatter = new Intl.DateTimeFormat("en-GB", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "UTC" });

export function formatDate(value: string | null) {
  if (!value) return "Awaiting first check";
  return `${dateFormatter.format(new Date(value))} UTC`;
}

export function MonitorTable({ monitors, loading, onDeleted }: { monitors: Monitor[]; loading: boolean; onDeleted: () => Promise<unknown> }) {
  const [filter, setFilter] = useState<"ALL" | MonitorStatus>("ALL");
  const [search, setSearch] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState("");
  const visible = monitors.filter((monitor) => (filter === "ALL" || monitor.status === filter) && `${monitor.name} ${monitor.url}`.toLowerCase().includes(search.toLowerCase()));

  async function remove(id: string) {
    setDeleting(id);
    setError("");
    try { await api(`/api/monitors?id=${encodeURIComponent(id)}`, { method: "DELETE" }); await onDeleted(); }
    catch (error) { setError(error instanceof Error ? error.message : "Could not delete monitor. Please retry."); }
    finally { setDeleting(null); }
  }

  return <>
    <div className="table-toolbar">
      <div className="filters" aria-label="Filter monitors by status">{(["ALL", "UP", "DOWN", "PENDING"] as const).map((status) => <button key={status} className={filter === status ? "filter active" : "filter"} aria-pressed={filter === status} onClick={() => setFilter(status)}>{status === "ALL" ? "All monitors" : status === "UP" ? "Operational" : status === "DOWN" ? "Down" : "Pending"}{status === "ALL" && <span className="count">{monitors.length}</span>}</button>)}</div>
      <label className="search-field"><Search size={15} /><span className="sr-only">Search monitors</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search monitors…" type="search" /></label>
    </div>
    {error && <div className="inline-error" role="alert">{error}<button className="text-button" onClick={() => setError("")}>Dismiss</button></div>}
    <div className="table-scroll"><table className="monitor-table"><caption className="sr-only">Service monitors and their latest check results</caption><thead><tr><th>Monitor</th><th>Status</th><th>HTTP</th><th>Response time</th><th>SSL expires</th><th>Last checked</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>
      {loading ? [0, 1, 2].map((row) => <tr key={row} aria-hidden="true">{Array.from({ length: 7 }, (_, index) => <td key={index}><div className="skeleton" /></td>)}</tr>) : visible.map((monitor) => <tr key={monitor.id}>
        <td><div className="monitor-identity"><span className="service-icon"><Globe2 size={19} /></span><div><span className="monitor-name">{monitor.name}</span><a className="endpoint" href={monitor.url} target="_blank" rel="noreferrer">{monitor.url.replace(/^https?:\/\//, "")}<ArrowUpRight size={11} /><span className="sr-only"> (opens in new tab)</span></a></div></div></td>
        <td><StatusBadge status={monitor.status} /></td>
        <td><span className={`http-code ${monitor.statusCode >= 400 ? "bad-code" : ""}`}>{monitor.statusCode || "—"}</span></td>
        <td className="tabular">{monitor.status === "PENDING" ? "—" : <>{monitor.latencyMs}<span className="unit">ms</span></>}</td>
        <td><span className={`ssl-value ${monitor.sslExpiryDays <= 14 && monitor.status !== "PENDING" ? "warning-text" : ""}`}><ShieldCheck size={14} />{monitor.status === "PENDING" ? "—" : `${monitor.sslExpiryDays} days`}</span></td>
        <td className="checked-time">{formatDate(monitor.lastChecked)}</td>
        <td><button className="icon-button delete-button" title={`Delete ${monitor.name}`} aria-label={`Delete ${monitor.name}`} disabled={deleting !== null} onClick={() => void remove(monitor.id)}>{deleting === monitor.id ? <LoaderCircle className="spin" size={15} /> : <Trash2 size={15} />}</button></td>
      </tr>)}
    </tbody></table></div>
    {!loading && visible.length === 0 && <div className="empty-state"><Radio size={24} /><h3>{monitors.length ? "No matching monitors" : "Your services, all in one place."}</h3><p>{monitors.length ? "Try another search or status filter." : "Add your first monitor to start tracking availability."}</p></div>}
    <div className="table-footer"><span>{loading ? "Loading monitors…" : `${visible.length} of ${monitors.length} monitors`}</span><span><span className="mini-dot" />Refreshes every 15 seconds</span></div>
  </>;
}
