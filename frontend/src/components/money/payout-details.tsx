"use client";
/**
 * Editor payout details. The editor saves how they want to be paid (several methods, one
 * preferred) in their profile; billing managers read them from the Money page. Krewsys
 * never holds or moves the money: the agency pays the editor directly.
 */
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Check, ChevronDown, Copy, Info, Loader2, Plus, Save, Trash2, Wallet } from "@/components/icons";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Select } from "@/components/ui/select";
import {
  PAYOUT_METHODS, payoutLabel, payoutMethod, payoutMethodError, payoutSummary,
  type PayoutDetails, type PayoutMethodId, type SavedPayoutMethod,
} from "@/lib/payout-details";
import { getMemberPayoutDetails, getMyPayoutDetails, saveMyPayoutDetails } from "./billing-client";
import "./payout-details.css";

const message = (reason: unknown) => (reason instanceof Error ? reason.message : "That didn't save.");

/** The short, collapsed "Why we ask" note. */
export function WhyWeAsk() {
  return <details className="payout-why">
    <summary><Info aria-hidden="true" />Why we ask<ChevronDown aria-hidden="true" className="payout-why-chevron" /></summary>
    <p>The agency pays you directly, using the details you save here. Krewsys never holds or moves money. Only you and the people who manage billing in this workspace can see these details; clients and other editors can&rsquo;t.</p>
  </details>;
}

type Draft = { key: string; method: PayoutMethodId; details: Record<string, string> };
let seq = 0;
const draftOf = (item: Pick<SavedPayoutMethod, "method" | "details">): Draft => ({ key: `m${seq++}`, method: item.method, details: { ...item.details } });

/** The editor's own form: in Settings / My profile. */
export function PayoutDetailsForm({ workspaceId, workspaceName, initial }: { workspaceId: string; workspaceName: string; initial?: PayoutDetails | null }) {
  const [loaded, setLoaded] = useState<PayoutDetails | null>(initial ?? null);
  const [drafts, setDrafts] = useState<Draft[]>(() => (initial?.methods ?? []).map(draftOf));
  const [preferred, setPreferred] = useState(() => Math.max(0, (initial?.methods ?? []).findIndex((item) => item.is_preferred)));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (initial) return;
    let active = true;
    getMyPayoutDetails(workspaceId).then((data) => {
      if (!active) return;
      setLoaded(data); setDrafts(data.methods.map(draftOf)); setPreferred(Math.max(0, data.methods.findIndex((item) => item.is_preferred)));
    }).catch((reason) => { if (active) setLoadError(message(reason)); });
    return () => { active = false; };
  }, [workspaceId, initial]);

  if (loadError) return <p className="form-error" role="alert">Payout details could not be loaded: {loadError}</p>;
  if (!loaded) return <p className="settings-muted" aria-live="polite"><Loader2 size={14} className="spin" /> Loading payout details…</p>;

  function update(index: number, next: Partial<Draft>) {
    setDrafts((current) => current.map((item, i) => (i === index ? { ...item, ...next } : item)));
  }
  function add() {
    const used = new Set(drafts.map((item) => item.method));
    const method = PAYOUT_METHODS.find((item) => !used.has(item.id))?.id ?? "other";
    setDrafts((current) => [...current, { key: `m${seq++}`, method, details: {} }]);
  }
  function remove(index: number) {
    setDrafts((current) => current.filter((_, i) => i !== index));
    setPreferred((current) => (index === current ? 0 : index < current ? current - 1 : current));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    for (const [index, item] of drafts.entries()) {
      const problem = payoutMethodError(item);
      if (problem) return setError(drafts.length > 1 ? `${payoutLabel(item.method)} (#${index + 1}): ${problem}` : problem);
    }
    setBusy(true); setError(null);
    try {
      const next = await saveMyPayoutDetails(workspaceId, drafts.map((item, index) => ({ method: item.method, details: item.details, is_preferred: index === preferred })));
      setLoaded(next); setDrafts(next.methods.map(draftOf)); setPreferred(Math.max(0, next.methods.findIndex((item) => item.is_preferred)));
      toast("Payout details saved", { description: `${workspaceName} will see your preferred method when they pay you.` });
    } catch (reason) { setError(message(reason)); } finally { setBusy(false); }
  }

  return <form className="settings-form payout-form" onSubmit={submit} aria-label="Payout details">
    {!loaded.encryption_configured && <p className="form-error" role="alert">Payout details can&rsquo;t be saved on this server yet. Ask the workspace owner to finish setup.</p>}
    {drafts.length === 0 && <div className="payout-empty"><Wallet aria-hidden="true" /><div><strong>No payout details yet</strong><p>Add how you&rsquo;d like {workspaceName} to pay you. You can add more than one and pick a preferred method.</p></div></div>}
    <ol className="payout-methods">
      {drafts.map((item, index) => {
        const def = payoutMethod(item.method)!;
        return <li key={item.key} className={index === preferred ? "payout-method is-preferred" : "payout-method"}>
          <div className="payout-method-head">
            <label className="payout-method-kind"><span>Method</span>
              <Select aria-label={`Payout method ${index + 1}`} value={item.method} onValueChange={(value) => update(index, { method: value as PayoutMethodId, details: {} })}
                options={PAYOUT_METHODS.map((option) => ({ value: option.id, label: option.label }))} /></label>
            <label className="payout-preferred"><input type="radio" name="payout-preferred" checked={index === preferred} onChange={() => setPreferred(index)} />Preferred</label>
            <button type="button" className="payout-icon-button" onClick={() => remove(index)} aria-label={`Remove ${def.label}`}><Trash2 size={15} /></button>
          </div>
          <div className={def.fields.length > 1 ? "settings-grid" : "payout-single"}>
            {def.fields.map((field) => <label key={field.name} className={field.kind === "textarea" ? "is-wide" : undefined}>
              <span className="payout-field-label">{field.label}{!field.required && <small className="settings-hint"> (optional)</small>}</span>
              {field.kind === "textarea"
                ? <textarea value={item.details[field.name] ?? ""} rows={3} maxLength={1000} onChange={(event) => update(index, { details: { ...item.details, [field.name]: event.target.value } })} />
                : <input value={item.details[field.name] ?? ""} placeholder={field.placeholder} autoComplete="off" spellCheck={false}
                  type={field.kind === "email" ? "email" : field.kind === "phone" ? "tel" : "text"} inputMode={field.kind === "phone" ? "tel" : undefined}
                  onChange={(event) => update(index, { details: { ...item.details, [field.name]: event.target.value } })} />}
            </label>)}
          </div>
        </li>;
      })}
    </ol>
    <div className="payout-actions">
      <button type="button" className="payout-add" onClick={add} disabled={drafts.length >= 8}><Plus size={15} />Add a method</button>
      <button className="settings-button" disabled={busy}>{busy ? <Loader2 size={15} className="spin" /> : <Save size={15} />}{busy ? "Saving…" : "Save payout details"}</button>
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}
    <WhyWeAsk />
  </form>;
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [done, setDone] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(value); setDone(true); toast(`${label} copied`); setTimeout(() => setDone(false), 1500); }
    catch { toast.error("Couldn't copy. Select the text instead."); }
  }
  return <button type="button" className="payout-copy" onClick={() => void copy()} aria-label={`Copy ${label}`}>{done ? <Check size={14} /> : <Copy size={14} />}</button>;
}

/** Billing managers: an editor's saved payout details with copy buttons. */
export function PayoutDetailsDialog({ workspaceId, membershipId, name, onClose, onRecord }: {
  workspaceId: string; membershipId: string; name: string; onClose: () => void; onRecord?: () => void;
}) {
  const [data, setData] = useState<PayoutDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    getMemberPayoutDetails(workspaceId, membershipId).then((next) => { if (active) setData(next); }).catch((reason) => { if (active) setError(message(reason)); });
    return () => { active = false; };
  }, [workspaceId, membershipId]);
  return <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
    <DialogContent className="money-dialog payout-dialog">
      <header className="money-dialog-head"><DialogTitle>Payout details · {name}</DialogTitle><DialogDescription>How {name} asked to be paid. You pay them directly; Krewsys never moves the money.</DialogDescription><DialogClose /></header>
      {error ? <p className="money-error" role="alert">{error}</p>
        : !data ? <p className="money-muted" aria-live="polite">Loading…</p>
          : data.methods.length === 0 ? <NoPayoutDetails name={name} />
            : <ul className="payout-view">{data.methods.map((item) => <li key={item.id ?? item.method} className={item.is_preferred ? "is-preferred" : undefined}>
              <header><strong>{payoutLabel(item.method)}</strong>{item.is_preferred && <span className="money-badge tone-success">Preferred</span>}</header>
              {item.unreadable ? <p className="money-error">These details can&rsquo;t be read on this server. Ask {name} to save them again.</p>
                : <dl>{(item.fields ?? []).map((field) => <div key={field.name}><dt>{field.label}</dt><dd><span>{field.value}</span><CopyButton value={field.value} label={field.label} /></dd></div>)}</dl>}
            </li>)}</ul>}
      <footer className="payout-dialog-foot">
        <button type="button" className="money-button" onClick={onClose}>Close</button>
        {onRecord && <button type="button" className="money-button is-primary" onClick={onRecord}>Record payout</button>}
      </footer>
    </DialogContent>
  </Dialog>;
}

export function NoPayoutDetails({ name }: { name: string }) {
  return <div className="payout-empty" role="status"><Wallet aria-hidden="true" /><div>
    <strong>No payout details yet</strong>
    <p>Ask editor: {name} can add how they&rsquo;d like to be paid under <b>My profile → Payout details</b>.</p>
  </div></div>;
}

export { payoutSummary };
