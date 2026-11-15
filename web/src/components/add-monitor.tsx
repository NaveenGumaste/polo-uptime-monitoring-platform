"use client";

import { useRef, useState, type FormEvent } from "react";
import { ArrowUpRight, LoaderCircle, Plus, Radio, X } from "lucide-react";
import { api } from "@/lib/api";

export function AddMonitor({ onAdded }: { onAdded: () => Promise<unknown> }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setSaving(true);
    setError("");
    try {
      await api("/api/monitors", { method: "POST", body: JSON.stringify({ name: data.get("name"), url: data.get("url") }) });
      form.reset();
      dialog.current?.close();
      await onAdded();
    } catch (error) { setError(error instanceof Error ? error.message : "Could not add monitor. Please retry."); }
    finally { setSaving(false); }
  }

  return <>
    <button className="button button-primary" onClick={() => { setError(""); dialog.current?.showModal(); }}><Plus size={16} />Add monitor</button>
    <dialog ref={dialog} className="monitor-dialog" aria-labelledby="add-title" onCancel={(event) => { if (saving) event.preventDefault(); }}>
      <div className="dialog-heading"><span className="dialog-icon"><Radio size={22} /></span><button className="icon-button" aria-label="Close add monitor" disabled={saving} onClick={() => dialog.current?.close()}><X size={18} /></button></div>
      <h2 id="add-title">Keep an eye on a service.</h2>
      <p className="muted">Add an endpoint to start tracking its availability.</p>
      <form onSubmit={submit} aria-busy={saving}>
        <label htmlFor="monitor-name">Monitor name</label>
        <input id="monitor-name" name="name" placeholder="e.g. Production API" required maxLength={120} disabled={saving} aria-describedby={error ? "add-error" : undefined} />
        <label htmlFor="monitor-url">Endpoint URL</label>
        <input id="monitor-url" name="url" type="url" placeholder="https://api.example.com/health" pattern="https?://.*" required maxLength={2048} disabled={saving} aria-describedby={error ? "add-error" : "url-hint"} />
        <p id="url-hint" className="field-hint">HTTP and HTTPS endpoints are supported.</p>
        {error && <p className="form-error" id="add-error" role="alert">{error}</p>}
        <div className="dialog-actions"><button type="button" className="button button-secondary" disabled={saving} onClick={() => dialog.current?.close()}>Cancel</button><button type="submit" className="button button-primary" disabled={saving}>{saving ? <LoaderCircle className="spin" size={16} /> : <ArrowUpRight size={16} />}{saving ? "Adding…" : "Create monitor"}</button></div>
      </form>
    </dialog>
  </>;
}
