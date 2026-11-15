"use client";

import { useState } from "react";
import useSWR from "swr";
import { Activity, ArrowDown, ArrowUpRight, ChevronRight, CircleCheck, Clock3, Layers2, LayoutDashboard, Radio, RefreshCw, Server, TriangleAlert, Zap } from "lucide-react";
import { api } from "@/lib/api";
import type { Incident, Monitor } from "@/lib/types";
import { AddMonitor } from "./add-monitor";
import { MonitorTable } from "./monitor-table";
import { IncidentTable } from "./incident-table";
import { HealthBanner } from "./health-banner";

const polling = { refreshInterval: 15_000, keepPreviousData: true, errorRetryInterval: 15_000 };

export function Dashboard() {
  const monitorRequest = useSWR<Monitor[], Error>("/api/monitors", api, polling);
  const incidentRequest = useSWR<Incident[], Error>("/api/incidents", api, polling);
  const [activeSection, setActiveSection] = useState("overview");
  const monitors = monitorRequest.data ?? [];
  const incidents = incidentRequest.data ?? [];
  const loading = monitorRequest.isLoading;
  const unavailable = !monitorRequest.data;
  const operational = monitors.filter((monitor) => monitor.status === "UP").length;
  const down = monitors.filter((monitor) => monitor.status === "DOWN").length;
  const checked = monitors.filter((monitor) => monitor.status !== "PENDING");
  const latency = checked.length ? Math.round(checked.reduce((total, monitor) => total + monitor.latencyMs, 0) / checked.length) : null;
  const refreshing = monitorRequest.isValidating || incidentRequest.isValidating;
  const error = monitorRequest.error || incidentRequest.error;

  async function refresh() { await Promise.all([monitorRequest.mutate(), incidentRequest.mutate()]); }

  return <div className="app-shell" id="overview">
    <a href="#main-content" className="skip-link">Skip to content</a>
    <aside className="sidebar">
      <a className="brand" href="#overview" aria-label="Polo home"><span className="brand-mark"><Activity size={23} strokeWidth={2.3} /></span><span>polo<span className="brand-period">.</span></span></a>
      <div className="workspace"><span className="workspace-avatar"><Layers2 size={17} /></span><div><strong>My workspace</strong><span>Uptime monitoring</span></div><span className="workspace-dot" /></div>
      <span className="nav-label">WORKSPACE</span>
      <nav aria-label="Main navigation">{[{ id: "overview", label: "Overview", icon: LayoutDashboard }, { id: "monitors", label: "Monitors", icon: Radio }, { id: "incidents", label: "Incidents", icon: TriangleAlert }].map(({ id, label, icon: Icon }) => <a key={id} href={`#${id}`} className={`nav-link ${activeSection === id ? "selected" : ""}`} aria-current={activeSection === id ? "location" : undefined} onClick={() => setActiveSection(id)}><Icon size={17} /><span>{label}</span>{id === "monitors" && monitorRequest.data && <span className="nav-count">{monitors.length}</span>}{id === "incidents" && incidents.length > 0 && <span className="nav-count">{incidents.length}</span>}</a>)}</nav>
      <div className="sidebar-bottom"><div className="sidebar-note"><span className="note-icon"><Zap size={17} /></span><strong>Stay one step ahead.</strong><p>A little visibility.<br />A lot of peace of mind.</p><a href="#monitors" onClick={() => setActiveSection("monitors")}>View your monitors<ArrowUpRight size={13} /></a></div><div className="sidebar-version"><span className="tiny-brand"><Activity size={13} />polo</span><span>v0.1.0</span></div></div>
    </aside>
    <div className="main-shell">
      <header className="topbar"><div className="breadcrumb"><span className="mobile-brand"><Activity size={20} /></span><span>Workspace</span><ChevronRight size={13} /><strong>Overview</strong></div><span className="topbar-caption"><span className="mini-dot" />15s auto-refresh</span></header>
      <main id="main-content">
        <div className="page-heading"><div><div className="eyebrow">YOUR SERVICES. IN SIGHT.</div><h1>Overview<span className="heading-dot">.</span></h1><p>A clear view of your uptime. A quieter day for your team.</p></div><div className="heading-actions"><button className="button button-secondary refresh-button" onClick={() => void refresh()} disabled={refreshing} aria-label="Refresh dashboard"><RefreshCw className={refreshing ? "spin" : ""} size={15} /><span>Refresh</span></button><AddMonitor onAdded={refresh} /></div></div>
        {error && <div className="connection-banner" role="alert"><TriangleAlert size={18} /><div><strong>{monitorRequest.data ? "Updates interrupted" : "Waiting for a database connection"}</strong><p>{error.message}{monitorRequest.data ? " Showing the last received data." : ""}</p></div><button className="button button-secondary" disabled={refreshing} onClick={() => void refresh()}>Retry</button></div>}
        <HealthBanner monitors={monitors} connected={!unavailable} loading={loading} />
        <div className="stats-grid" aria-label="Monitoring summary">
          <Stat label="Total monitors" value={unavailable ? "—" : monitors.length} detail="Endpoints in your workspace" icon={<Server size={17} />} />
          <Stat label="Operational" value={unavailable ? "—" : operational} detail={unavailable || !monitors.length ? "Awaiting check results" : `${Math.round(operational / monitors.length * 100)}% of your monitors`} icon={<CircleCheck size={17} />} accent="green" />
          <Stat label="Down" value={unavailable ? "—" : down} detail={down ? "Requires your attention" : "No services reporting downtime"} icon={<ArrowDown size={17} />} accent={down ? "red" : undefined} />
          <Stat label="Average latency" value={latency ?? "—"} unit={latency !== null ? "ms" : undefined} detail="Across the latest check results" icon={<Clock3 size={17} />} />
        </div>
        <section className="panel" id="monitors"><div className="panel-heading"><div><div className="section-title"><h2>Monitors</h2><span className="live-label"><span className="mini-dot" />{error ? "Sync paused" : loading ? "Connecting" : "Live"}</span></div><p>The heartbeat of your services, at a glance.</p></div><span className="quiet-label"><Radio size={14} />HTTP / HTTPS</span></div><MonitorTable monitors={monitors} loading={loading} onDeleted={refresh} /></section>
        {incidentRequest.error && <p className="incident-error" role="status">Incident history is temporarily unavailable. Retrying automatically.</p>}
        <IncidentTable incidents={incidents} monitors={monitors} loading={incidentRequest.isLoading} unavailable={Boolean(incidentRequest.error && !incidentRequest.data)} />
        <footer className="page-footer"><span><Activity size={13} />Small checks. Greater peace of mind.</span><span>Polo <span className="footer-separator">/</span> Uptime monitoring & incident alerting</span></footer>
      </main>
    </div>
  </div>;
}

function Stat({ label, value, unit, detail, icon, accent }: { label: string; value: string | number; unit?: string; detail: string; icon: React.ReactNode; accent?: string }) {
  return <section className={`stat-card ${accent ? `stat-${accent}` : ""}`} aria-label={label}><div className="stat-top"><h2>{label}</h2><span className="stat-icon">{icon}</span></div><div className="stat-value">{value}{unit && <span>{unit}</span>}</div><p>{accent === "green" && <span className="mini-dot" />}{detail}</p></section>;
}
