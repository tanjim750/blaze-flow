"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Check, Copy, ExternalLink, Info, KeyRound, Loader2, RefreshCw, Save, ShieldCheck, Sparkles, TriangleAlert, Unlink } from "@/components/icons";
import { Switch } from "@/components/ui/switch";
import {
  currencyNote, disconnectGateway, enableGateway, gatewayBadge, saveGatewayKeys, testGateway, type GatewayMode, type LocalGateway,
} from "@/lib/payment-gateways";

type Busy = null | "save" | "test" | "enable" | "disconnect";
const LOGO_TONE: Record<string, string> = { paymongo: "#24b47e", safepay: "#1f6feb", sslcommerz: "#e2136e" };

/**
 * One local gateway (PayMongo, Safepay or SSLCOMMERZ) in Settings → Billing. Owners/admins paste
 * the agency's own merchant keys, pick sandbox or live, test the connection and switch it on.
 * Saved secrets never come back from the server: the form shows a masked hint and a blank field
 * keeps the saved value.
 */
export function LocalGatewayCard({ workspaceId, initial, canManage, workspaceCurrency }: { workspaceId: string; initial: LocalGateway; canManage: boolean; workspaceCurrency: string }) {
  const [gateway, setGateway] = useState(initial);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<GatewayMode>(initial.mode ?? "sandbox");
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const badge = gatewayBadge(gateway);
  const note = currencyNote(gateway, workspaceCurrency);
  const saved = gateway.connection_status !== "not_connected";
  const dirty = mode !== gateway.mode || Object.values(values).some((value) => value.trim() !== "");
  const missing = gateway.fields.filter((field) => field.required && !values[field.name]?.trim() && !gateway.credentials[field.name]);

  async function run(kind: Busy, action: () => Promise<LocalGateway>, done?: (next: LocalGateway) => void) {
    setBusy(kind); setError(null);
    try { const next = { ...(await action()), recommended: gateway.recommended }; setGateway(next); done?.(next); }
    catch (reason) { setError(reason instanceof Error ? reason.message : `${gateway.name} didn't respond. Try again.`); }
    finally { setBusy(null); }
  }
  const save = () => run("save", () => saveGatewayKeys(workspaceId, gateway.key, mode, values), (next) => {
    setValues({}); setMode(next.mode);
    toast(`${gateway.name} keys saved`, { description: "Test the connection, then switch it on." });
  });
  const test = () => run("test", () => testGateway(workspaceId, gateway.key), (next) => {
    if (next.connection_status === "connected") toast.success(`${gateway.name} connected (${next.mode})`);
    else toast.error(next.status_message || `${gateway.name} rejected those keys`);
  });
  const toggle = (enabled: boolean) => run("enable", () => enableGateway(workspaceId, gateway.key, enabled),
    (next) => toast(next.enabled ? `${gateway.name} is on. Clients can pay with it.` : `${gateway.name} is off`));
  const disconnect = () => { if (confirm(`Remove the ${gateway.name} keys? Clients can no longer pay with ${gateway.name}.`)) void run("disconnect", () => disconnectGateway(workspaceId, gateway.key), () => { setOpen(false); setMode("sandbox"); toast(`${gateway.name} keys removed`); }); };
  const copy = (text: string) => { void navigator.clipboard?.writeText(text).then(() => toast("Webhook URL copied"), () => toast.error("Couldn't copy. Select the URL and copy it.")); };

  return <section className={`gateway-card${gateway.recommended ? " is-recommended" : ""}${gateway.enabled ? " is-on" : ""}`} aria-label={gateway.name}>
    <div className="gateway-card-head">
      <span className="gateway-logo" aria-hidden="true" style={{ background: LOGO_TONE[gateway.key] ?? "#7c5cff" }}>{gateway.name.slice(0, 1)}</span>
      <div className="gateway-title">
        <strong>{gateway.name}{gateway.recommended && <span className="gateway-reco"><Sparkles aria-hidden="true" />Recommended</span>}</strong>
        <small>{gateway.countries.join(", ")} · {gateway.currencies.join(", ")} only</small>
      </div>
      <span className={`stripe-status tone-${badge.tone}`}>{badge.label}</span>
    </div>
    <p className="stripe-note">{gateway.description}</p>
    {gateway.methods.length > 0 && <ul className="gateway-methods" aria-label={`${gateway.name} payment methods`}>{gateway.methods.map((method) => <li key={method}>{method}</li>)}</ul>}
    {note && <p className="stripe-note is-warn"><TriangleAlert aria-hidden="true" />{note}</p>}
    {gateway.connection_status === "failed" && gateway.status_message && <p className="stripe-note is-danger" role="status">{gateway.status_message}</p>}
    {gateway.connection_status === "unreadable" && <p className="stripe-note is-danger" role="status">The saved keys can&rsquo;t be decrypted (the server&rsquo;s encryption key changed). Enter them again.</p>}
    {!canManage && <p className="stripe-note is-muted">Only workspace owners and admins can add or change {gateway.name} keys.</p>}
    {canManage && !gateway.encryption_configured && <p className="stripe-note is-warn"><ShieldCheck aria-hidden="true" />Saving keys is switched off until the server has an encryption key (GATEWAY_ENCRYPTION_KEY). Ask whoever runs Blaze Flow to set it.</p>}

    {canManage && <div className="stripe-actions gateway-actions">
      <button type="button" className={`settings-button${saved ? " is-quiet" : " stripe-primary"}`} aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <KeyRound size={15} />{open ? "Hide keys" : saved ? "Edit keys" : `Set up ${gateway.name}`}</button>
      {saved && <button type="button" className="settings-button is-quiet" disabled={busy !== null || dirty} onClick={() => void test()}>
        {busy === "test" ? <Loader2 size={15} className="spin" /> : <RefreshCw size={15} />}Test connection</button>}
      {saved && <label className="gateway-switch" title={gateway.connection_status === "connected" ? undefined : "Test the connection first"}>
        <Switch checked={gateway.enabled} onCheckedChange={(next) => { if (busy === null && (gateway.connection_status === "connected" || !next)) void toggle(next); }} label={`Accept payments with ${gateway.name}`} />
        <span>{gateway.enabled ? "Accepting payments" : "Off"}</span></label>}
    </div>}
    {canManage && saved && gateway.connection_status !== "connected" && !gateway.enabled && <p className="stripe-note is-muted">Test the connection to switch {gateway.name} on.</p>}

    {canManage && open && <form className="gateway-form" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <fieldset className="gateway-mode"><legend>Mode</legend>
        {(["sandbox", "live"] as const).map((value) => <label key={value} className={mode === value ? "is-active" : ""}>
          <input type="radio" name={`${gateway.key}-mode`} value={value} checked={mode === value} onChange={() => setMode(value)} />
          {value === "sandbox" ? "Sandbox (test)" : "Live"}</label>)}
      </fieldset>
      {mode === "live" && <p className="stripe-note is-muted">Live mode takes real money. Use your live keys from the {gateway.name} dashboard.</p>}
      {gateway.fields.map((field) => {
        const current = gateway.credentials[field.name];
        return <label key={field.name} className="gateway-field"><span>{field.label}{field.secret && <em>secret</em>}</span>
          <input type={field.secret ? "password" : "text"} autoComplete="off" spellCheck={false} value={values[field.name] ?? ""}
            placeholder={current ? (field.secret ? `Saved ${current} · leave blank to keep` : current) : field.placeholder}
            onChange={(event) => setValues((prev) => ({ ...prev, [field.name]: event.target.value }))} disabled={!gateway.encryption_configured || busy !== null} />
          {field.help && <small>{field.help}</small>}
        </label>;
      })}
      <p className="stripe-note is-muted"><ShieldCheck aria-hidden="true" />Keys are encrypted on the server and never shown again; only the last four characters are displayed.</p>
      {gateway.keys_help && <p className="stripe-note is-muted"><Info aria-hidden="true" />{gateway.keys_help}</p>}
      {gateway.webhook_url && <div className="gateway-webhook">
        <span>{gateway.webhook_in_dashboard ? "Webhook URL (add it in the dashboard)" : "Notification (IPN) URL"}</span>
        <div><code>{gateway.webhook_url}</code><button type="button" className="settings-button is-quiet" onClick={() => copy(gateway.webhook_url!)} aria-label="Copy webhook URL"><Copy size={14} />Copy</button></div>
        {gateway.webhook_help && <small>{gateway.webhook_help}</small>}
      </div>}
      <p className="gateway-links">
        <a href={gateway.docs_url} target="_blank" rel="noreferrer"><ExternalLink size={13} />Developer docs</a>
        <a href={gateway.signup_url} target="_blank" rel="noreferrer"><ExternalLink size={13} />Create a {gateway.name} account</a>
      </p>
      <div className="stripe-actions">
        <button type="submit" className="settings-button stripe-primary" disabled={busy !== null || !dirty || missing.length > 0 || !gateway.encryption_configured}>
          {busy === "save" ? <Loader2 size={15} className="spin" /> : <Save size={15} />}Save keys</button>
        {saved && <button type="button" className="settings-button is-quiet is-danger" disabled={busy !== null} onClick={disconnect}>
          {busy === "disconnect" ? <Loader2 size={15} className="spin" /> : <Unlink size={15} />}Remove keys</button>}
      </div>
      {missing.length > 0 && dirty && <p className="stripe-note is-muted">Still needed: {missing.map((field) => field.label).join(", ")}.</p>}
    </form>}
    {gateway.last_tested_at && gateway.connection_status === "connected" && <p className="stripe-note is-muted gateway-tested"><Check aria-hidden="true" />Tested {new Date(gateway.last_tested_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })} · {gateway.mode}</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
  </section>;
}
