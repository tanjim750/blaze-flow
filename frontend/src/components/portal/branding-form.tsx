"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, ImageUp, Plus, Trash2, TriangleAlert } from "lucide-react";
import {
  BRAND_SWATCHES, LOGO_ACCEPT, accentStyle, isHexColor, logoProblem, removeLogo, saveBranding, uploadLogo, type Branding,
} from "@/lib/portal";
import { PortalBrandBar } from "./brand-bar";

/**
 * Settings → Client portal branding. The logo saves as soon as it is picked; colour and
 * welcome line save with the button. The preview is the real brand bar the client sees.
 */
export function BrandingForm({ workspaceId, initial, canEdit }: { workspaceId: string; initial: Branding; canEdit: boolean }) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [branding, setBranding] = useState(initial);
  const [color, setColor] = useState(initial.brand_color ?? "");
  const [welcome, setWelcome] = useState(initial.portal_welcome ?? "");
  const [busy, setBusy] = useState<"logo" | "save" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const colorOk = !color || isHexColor(color);
  const preview: Branding = { ...branding, brand_color: colorOk && color ? color : null, portal_welcome: welcome.trim() || null };

  async function pickLogo(file: File | undefined) {
    if (!file) return;
    const problem = logoProblem(file);
    if (problem) { setError(problem); return; }
    setBusy("logo");
    setError(null);
    const result = await uploadLogo(workspaceId, file);
    setBusy(null);
    if (fileInput.current) fileInput.current.value = "";
    if (!result.ok) { setError(result.error); return; }
    setBranding(result.data);
    router.refresh();
  }

  async function dropLogo() {
    setBusy("logo");
    const result = await removeLogo(workspaceId);
    setBusy(null);
    if (!result.ok) { setError(result.error); return; }
    setBranding(result.data);
    router.refresh();
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!colorOk) { setError("Use a colour like #7C5CFF."); return; }
    setBusy("save");
    setError(null);
    setSaved(false);
    const result = await saveBranding(workspaceId, { brand_color: color || null, portal_welcome: welcome });
    setBusy(null);
    if (!result.ok) { setError(result.error); return; }
    setBranding(result.data);
    setSaved(true);
    router.refresh();
  }

  return <form className="pt-branding" onSubmit={save}>
    <div className="pt-branding-fields">
      <div className="pt-field">Logo <small>PNG, JPG or WebP, up to 2 MB. A wide logo on a transparent background works best.</small>
        <div className="pt-logo-row">
          <span className="pt-logo-box">{branding.logo_url
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={branding.logo_url} alt={`${branding.studio_name} logo`} />
            : <ImageUp size={20} color="var(--muted)" aria-hidden="true" />}</span>
          <input ref={fileInput} type="file" accept={LOGO_ACCEPT} hidden onChange={(event) => pickLogo(event.target.files?.[0])} aria-label="Logo file" />
          <button type="button" className="pt-ghost" disabled={!canEdit || busy !== null} onClick={() => fileInput.current?.click()}><Plus />{busy === "logo" ? "Uploading…" : branding.logo_url ? "Replace" : "Upload logo"}</button>
          {branding.logo_url && <button type="button" className="pt-ghost is-danger" disabled={!canEdit || busy !== null} onClick={dropLogo}><Trash2 />Remove</button>}
        </div>
      </div>
      <div className="pt-field">Accent colour <small>Used for highlights and buttons on the client portal and upload pages. Leave empty for Blaze Flow violet.</small>
        <div className="pt-color-row">
          <input type="color" value={colorOk && color ? color : "#8B6CFF"} onChange={(event) => setColor(event.target.value.toUpperCase())} disabled={!canEdit} aria-label="Pick accent colour" />
          <input type="text" value={color} onChange={(event) => setColor(event.target.value.trim())} placeholder="#8B6CFF" maxLength={7} disabled={!canEdit} aria-label="Accent colour hex" aria-invalid={!colorOk} />
          {BRAND_SWATCHES.map((swatch) => <button type="button" key={swatch} className="pt-swatch" style={{ background: swatch }} aria-label={`Use ${swatch}`} aria-pressed={color.toUpperCase() === swatch} disabled={!canEdit} onClick={() => setColor(swatch)} />)}
          {color && <button type="button" className="pt-ghost" onClick={() => setColor("")} disabled={!canEdit}>Reset</button>}
        </div>
      </div>
      <label className="pt-field">Welcome line <small>One or two sentences at the top of the portal.</small>
        <textarea value={welcome} onChange={(event) => setWelcome(event.target.value)} maxLength={280} rows={2} style={{ minHeight: 70 }} disabled={!canEdit} placeholder="Everything for your projects with us, in one place." />
      </label>
      {error && <p className="pt-alert is-error" role="alert"><TriangleAlert />{error}</p>}
      {saved && !error && <p className="pt-alert is-success" role="status"><CheckCircle2 />Branding saved. Clients see it on their next visit.</p>}
      <div><button className="pt-cta" style={accentStyle(preview.brand_color)} disabled={!canEdit || busy !== null}>{busy === "save" ? "Saving…" : "Save branding"}</button></div>
      {!canEdit && <small style={{ color: "var(--muted)" }}>Only people who manage the workspace can change branding.</small>}
    </div>
    <div className="pt-preview pt-scope" style={accentStyle(preview.brand_color)} aria-label="Preview">
      <small>What your clients see</small>
      <PortalBrandBar branding={preview}><span className="pt-cta">Start a new project</span></PortalBrandBar>
      <div className="pt-preview-row"><span className="pt-pill is-waiting">Ready for you</span><span className="pt-pill is-approved">Approved</span><span className="pt-ghost">Watch</span></div>
    </div>
  </form>;
}
