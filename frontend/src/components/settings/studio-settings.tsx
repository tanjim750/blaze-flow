"use client";

import { useState, type FormEvent } from "react";
import { Loader2, Plus, Save, X } from "@/components/icons";
import { toast } from "sonner";
import { api } from "@/components/tasks/tasks-api";
import { setMemberRate } from "@/components/money/billing-client";
import { formatMoney } from "@/lib/money";
import {
  GLOSSARY_KINDS, invoiceNumberPreview, invoiceSettingsError,
  type GlossaryKind, type GlossaryTerm, type InvoiceSettings, type RateRow,
} from "@/lib/studio-settings";

const message = (reason: unknown) => (reason instanceof Error ? reason.message : "That didn't save.");

export function InvoiceSettingsForm({ workspaceId, initial, canEdit }: { workspaceId: string; initial: InvoiceSettings; canEdit: boolean }) {
  const [value, setValue] = useState({ currency: initial.currency, payment_terms_days: String(initial.payment_terms_days), invoice_prefix: initial.invoice_prefix });
  const [saved, setSaved] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dirty = value.currency.toUpperCase() !== saved.currency || Number(value.payment_terms_days) !== saved.payment_terms_days || value.invoice_prefix.trim() !== saved.invoice_prefix;

  async function submit(event: FormEvent) {
    event.preventDefault();
    const problem = invoiceSettingsError(value);
    setError(problem);
    if (problem) return;
    setBusy(true);
    try {
      const next = await api<InvoiceSettings>(`workspaces/${workspaceId}/billing/settings/`, "PATCH", {
        currency: value.currency.trim().toUpperCase(), payment_terms_days: Number(value.payment_terms_days), invoice_prefix: value.invoice_prefix.trim(),
      });
      setSaved(next);
      setValue({ currency: next.currency, payment_terms_days: String(next.payment_terms_days), invoice_prefix: next.invoice_prefix });
      toast("Invoicing settings saved");
    } catch (reason) { setError(message(reason)); } finally { setBusy(false); }
  }

  const set = (key: keyof typeof value) => (event: { target: { value: string } }) => setValue((current) => ({ ...current, [key]: event.target.value }));
  return <form className="settings-form" onSubmit={submit} aria-label="Invoicing">
    <div className="settings-grid is-three">
      <label>Invoice prefix<input value={value.invoice_prefix} onChange={set("invoice_prefix")} maxLength={20} disabled={!canEdit} aria-describedby="inv-prefix-hint" /><small id="inv-prefix-hint" className="settings-hint">Numbers look like {invoiceNumberPreview(value.invoice_prefix)}</small></label>
      <label>Payment terms (days)<input value={value.payment_terms_days} onChange={set("payment_terms_days")} inputMode="numeric" type="number" min={0} max={365} disabled={!canEdit} /><small className="settings-hint">Due date when an invoice is sent</small></label>
      <label>Currency<input value={value.currency} onChange={set("currency")} maxLength={3} placeholder="GBP" disabled={!canEdit} style={{ textTransform: "uppercase" }} /><small className="settings-hint">For new prices and invoices</small></label>
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}
    {canEdit && <button className="settings-button" disabled={busy || !dirty}>{busy ? <Loader2 size={15} className="spin" /> : <Save size={15} />}{busy ? "Saving…" : "Save invoicing"}</button>}
  </form>;
}

export function RatesForm({ workspaceId, currency, rows, canEdit }: { workspaceId: string; currency: string; rows: RateRow[]; canEdit: boolean }) {
  const [rates, setRates] = useState(() => Object.fromEntries(rows.map((row) => [row.membership_id, row.default_rate ?? ""])));
  const [saved, setSaved] = useState(rates);
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const active = rows.filter((row) => row.active);
  if (!active.length) return <p className="settings-muted">No editors yet. Invite your team from Team &amp; Roles.</p>;

  async function save(row: RateRow) {
    const raw = (rates[row.membership_id] ?? "").trim();
    if (raw === (saved[row.membership_id] ?? "")) return;
    if (raw && !(Number(raw) >= 0)) { setErrors((e) => ({ ...e, [row.membership_id]: "Enter an amount, or leave it empty." })); return; }
    setBusy(row.membership_id); setErrors((e) => ({ ...e, [row.membership_id]: "" }));
    try {
      const result = await setMemberRate(workspaceId, row.membership_id, raw || null);
      const value = result.default_task_rate ?? "";
      setRates((r) => ({ ...r, [row.membership_id]: value })); setSaved((s) => ({ ...s, [row.membership_id]: value }));
      toast(value ? `${row.name}: ${formatMoney(value, currency)} per task` : `${row.name}: default rate cleared`);
    } catch (reason) { setErrors((e) => ({ ...e, [row.membership_id]: message(reason) })); } finally { setBusy(null); }
  }

  return <ul className="settings-rates" aria-label="Default rates">
    {active.map((row) => <li key={row.membership_id}>
      <span><strong>{row.name}</strong><small>{[row.role, row.email].filter(Boolean).join(" · ")}</small></span>
      <label className="settings-money">
        <span className="sr-only">Default rate per task for {row.name}</span>
        <i aria-hidden>{currency}</i>
        <input inputMode="decimal" placeholder="No default" value={rates[row.membership_id] ?? ""} disabled={!canEdit || busy === row.membership_id}
          onChange={(event) => setRates((r) => ({ ...r, [row.membership_id]: event.target.value }))}
          onBlur={() => void save(row)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void save(row); } }} />
        {busy === row.membership_id && <Loader2 size={14} className="spin" aria-label="Saving" />}
      </label>
      {errors[row.membership_id] && <p className="form-error" role="alert">{errors[row.membership_id]}</p>}
    </li>)}
  </ul>;
}

export function GlossaryForm({ workspaceId, initial, canEdit }: { workspaceId: string; initial: GlossaryTerm[]; canEdit: boolean }) {
  const [terms, setTerms] = useState(initial);
  const [term, setTerm] = useState("");
  const [kind, setKind] = useState<GlossaryKind>("brand");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const shown = query.trim() ? terms.filter((t) => t.term.toLowerCase().includes(query.trim().toLowerCase())) : terms;

  async function add(event: FormEvent) {
    event.preventDefault();
    const value = term.trim();
    if (!value) return;
    if (terms.some((t) => t.term.toLowerCase() === value.toLowerCase())) { setError(`“${value}” is already in the glossary.`); return; }
    setBusy(true); setError(null);
    try {
      const created = await api<GlossaryTerm>(`workspaces/${workspaceId}/ai-glossary/`, "POST", { term: value, kind });
      setTerms((list) => [...list.filter((t) => t.id !== created.id), created].sort((a, b) => a.normalized.localeCompare(b.normalized)));
      setTerm("");
    } catch (reason) { setError(message(reason)); } finally { setBusy(false); }
  }

  async function remove(item: GlossaryTerm) {
    setTerms((list) => list.filter((t) => t.id !== item.id));
    try { await api<void>(`workspaces/${workspaceId}/ai-glossary/${item.id}/`, "DELETE"); toast(`Removed “${item.term}”`); }
    catch (reason) { setTerms((list) => [...list, item].sort((a, b) => a.normalized.localeCompare(b.normalized))); toast.error(message(reason)); }
  }

  const label = (value: GlossaryKind) => GLOSSARY_KINDS.find((k) => k.value === value)?.label ?? value;
  return <div className="settings-form">
    {canEdit && <form className="settings-glossary-add" onSubmit={add} aria-label="Add a glossary term">
      <label><span className="sr-only">Term</span><input value={term} onChange={(event) => setTerm(event.target.value)} maxLength={200} placeholder="e.g. BlazeFlow, iPhone, NHS" /></label>
      <label><span className="sr-only">Kind</span><select value={kind} onChange={(event) => setKind(event.target.value as GlossaryKind)}>{GLOSSARY_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}</select></label>
      <button className="settings-button" disabled={busy || !term.trim()}>{busy ? <Loader2 size={15} className="spin" /> : <Plus size={15} />}Add term</button>
    </form>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {terms.length > 8 && <label><span className="sr-only">Filter terms</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Filter ${terms.length} terms`} /></label>}
    {terms.length === 0 ? <p className="settings-muted">No terms yet. Add brand and product names so AI QA doesn&rsquo;t flag them as typos.</p>
      : <ul className="settings-glossary" aria-label="Glossary terms">{shown.map((item) => <li key={item.id}>
        <strong>{item.term}</strong><small>{label(item.kind)}</small>
        {canEdit && <button type="button" onClick={() => void remove(item)} aria-label={`Remove ${item.term}`}><X size={13} /></button>}
      </li>)}</ul>}
  </div>;
}
