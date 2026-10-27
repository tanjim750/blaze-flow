"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ExternalLink, Info, Landmark, Loader2, Plus, Save, Trash2 } from "@/components/icons";
import { Switch } from "@/components/ui/switch";
import { enableGateway, saveManualDetails, type ManualAccount, type ManualGateway } from "@/lib/payment-gateways";

const LOGO_TONE: Record<string, string> = { wise: "#9fe870", payoneer: "#ff4800" };
const LOGO_INK: Record<string, string> = { wise: "#163300", payoneer: "#fff" };
type Row = ManualAccount & { key: string };

/**
 * Pay by Wise / Payoneer. Neither offers a merchant API to create a payment request, so the agency
 * saves its receiving details (per currency) and/or a payment link. Clients see them on the invoice
 * with the invoice number as reference, press "I've paid", and the team confirms the payment.
 */
export function ManualGatewayCard({ workspaceId, initial, canManage, workspaceCurrency }: { workspaceId: string; initial: ManualGateway; canManage: boolean; workspaceCurrency: string }) {
  const [gateway, setGateway] = useState(initial);
  const [open, setOpen] = useState(false);
  const [link, setLink] = useState(initial.payment_link);
  const [note, setNote] = useState(initial.note);
  const [rows, setRows] = useState<Row[]>(() => (initial.accounts.length ? initial.accounts : [{ currency: workspaceCurrency, details: "" }]).map((a, i) => ({ ...a, key: `r${i}` })));
  const [busy, setBusy] = useState<null | "save" | "enable">(null);
  const [error, setError] = useState<string | null>(null);
  const filled = rows.filter((row) => row.details.trim());
  const canSave = Boolean(link.trim() || filled.length);
  const patch = (key: string, value: Partial<Row>) => setRows((list) => list.map((row) => row.key === key ? { ...row, ...value } : row));

  async function save() {
    setBusy("save"); setError(null);
    try {
      const next = await saveManualDetails(workspaceId, gateway.key, { payment_link: link.trim(), note: note.trim(), accounts: filled.map(({ currency, details }) => ({ currency: currency.trim().toUpperCase(), details: details.trim() })) });
      setGateway({ ...next, recommended: gateway.recommended }); setOpen(false);
      toast(`${gateway.name} details saved`, { description: next.enabled ? "Clients see the new details." : "Switch it on to show them on invoices." });
    } catch (reason) { setError(reason instanceof Error ? reason.message : "That didn't save."); } finally { setBusy(null); }
  }
  async function toggle(enabled: boolean) {
    setBusy("enable"); setError(null);
    try { const next = await enableGateway(workspaceId, gateway.key, enabled) as unknown as ManualGateway; setGateway({ ...gateway, ...next }); toast(enabled ? `Pay by ${gateway.name} is on` : `Pay by ${gateway.name} is off`); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "That didn't save."); } finally { setBusy(null); }
  }

  const summary = gateway.connected
    ? [gateway.accounts.map((a) => a.currency).join(", "), gateway.payment_link && "payment link"].filter(Boolean).join(" · ")
    : "Not set up";
  return <section className={`gateway-card${gateway.enabled ? " is-on" : ""}`} aria-label={gateway.name}>
    <div className="gateway-card-head">
      <span className="gateway-logo" aria-hidden="true" style={{ background: LOGO_TONE[gateway.key] ?? "#7c5cff", color: LOGO_INK[gateway.key] ?? "#fff" }}>{gateway.name.slice(0, 1)}</span>
      <div className="gateway-title"><strong>{gateway.name}<span className="gateway-kind">Manual</span></strong><small>{gateway.methods.join(" · ")}</small></div>
      <span className={`stripe-badge tone-${gateway.enabled ? "success" : "neutral"}`}>{gateway.enabled ? "On" : gateway.connected ? "Saved · off" : "Off"}</span>
    </div>
    <p className="gateway-desc">{gateway.description}</p>
    <p className="stripe-note is-muted"><Info aria-hidden="true" />Not automatic: clients pay you directly and press &ldquo;I&rsquo;ve paid&rdquo;. You confirm it on the invoice (or Mark as paid) once the money arrives.</p>
    {gateway.connected && !open && <p className="stripe-note is-muted gateway-tested"><Landmark aria-hidden="true" />Details for {summary}</p>}
    {!canManage && <p className="stripe-note is-muted">Only workspace owners and admins can change {gateway.name} details.</p>}
    {canManage && <div className="stripe-actions gateway-actions">
      <button type="button" className={`settings-button${gateway.connected ? " is-quiet" : " stripe-primary"}`} aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <Landmark size={15} />{open ? "Hide details" : gateway.connected ? "Edit details" : `Add ${gateway.name} details`}</button>
      {gateway.connected && <label className="gateway-switch"><Switch checked={gateway.enabled} onCheckedChange={(next) => { if (busy === null) void toggle(next); }} label={`Show Pay by ${gateway.name} on invoices`} />
        <span>{gateway.enabled ? "Shown on invoices" : "Off"}</span></label>}
    </div>}
    {canManage && open && <form className="gateway-form" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <label className="gateway-field"><span>{gateway.link_label}<em>optional</em></span>
        <input type="url" inputMode="url" value={link} placeholder={gateway.key === "wise" ? "https://wise.com/pay/me/yourname" : "https://link.payoneer.com/Token?t=…"} onChange={(event) => setLink(event.target.value)} disabled={busy !== null} />
        <small>{gateway.link_help}</small></label>
      <fieldset className="manual-accounts"><legend>Receiving details by currency</legend>
        <small className="settings-hint">{gateway.details_help}</small>
        {rows.map((row, index) => <div key={row.key} className="manual-account">
          <label className="gateway-field is-currency"><span>Currency</span>
            <input value={row.currency} maxLength={3} aria-label={`Currency ${index + 1}`} onChange={(event) => patch(row.key, { currency: event.target.value.toUpperCase() })} disabled={busy !== null} /></label>
          <label className="gateway-field is-grow"><span>Account details</span>
            <textarea rows={3} maxLength={1500} value={row.details} aria-label={`${row.currency || "Currency"} account details`} placeholder={"Account holder: Your Studio Ltd\nAccount number: 12345678\nRouting / sort code / IBAN / SWIFT"} onChange={(event) => patch(row.key, { details: event.target.value })} disabled={busy !== null} /></label>
          <button type="button" className="settings-button is-quiet is-icon" aria-label={`Remove ${row.currency || "row"}`} disabled={busy !== null || rows.length === 1} onClick={() => setRows((list) => list.filter((item) => item.key !== row.key))}><Trash2 size={15} /></button>
        </div>)}
        {rows.length < 12 && <button type="button" className="settings-button is-quiet" onClick={() => setRows((list) => [...list, { key: `r${Date.now()}`, currency: "", details: "" }])}><Plus size={15} />Add currency</button>}
      </fieldset>
      <label className="gateway-field"><span>Note for clients<em>optional</em></span>
        <input value={note} maxLength={500} placeholder="e.g. Please include the invoice number as the reference." onChange={(event) => setNote(event.target.value)} disabled={busy !== null} /></label>
      <p className="stripe-note is-muted"><Info aria-hidden="true" />These details are shown to clients on invoices and the pay link, so only add what you&rsquo;d put on an invoice.</p>
      <p className="gateway-links">
        <a href={gateway.docs_url} target="_blank" rel="noreferrer"><ExternalLink size={13} />Where to find your details</a>
        <a href={gateway.signup_url} target="_blank" rel="noreferrer"><ExternalLink size={13} />Create a {gateway.name} account</a>
      </p>
      <div className="stripe-actions"><button type="submit" className="settings-button stripe-primary" disabled={busy !== null || !canSave}>
        {busy === "save" ? <Loader2 size={15} className="spin" /> : <Save size={15} />}Save details</button></div>
      {!canSave && <p className="stripe-note is-muted">Add a payment link or at least one currency&rsquo;s details.</p>}
    </form>}
    {error && <p className="form-error" role="alert">{error}</p>}
  </section>;
}
