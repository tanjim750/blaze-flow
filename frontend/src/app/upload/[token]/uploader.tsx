"use client";

import { useMemo, useState } from "react";
import { CalendarClock, CircleCheckBig, Lock } from "lucide-react";
import { DropUploader } from "@/components/client-uploads/drop-uploader";
import { publicUploadUrl, shortDateTime, type PublicUploadLink } from "@/lib/client-uploads";
import { accentStyle } from "@/lib/portal";
import { StudioMark } from "@/components/portal/studio-mark";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Why uploads cannot start yet, or null. Exported for tests. */
export function senderProblem(name: string, email: string): string | null {
  if (!name.trim()) return "Add your name above so the studio knows who sent these.";
  if (!EMAIL.test(email.trim())) return "Add a valid email above to start sending.";
  return null;
}

export function PublicUploader({ token, link }: { token: string; link: PublicUploadLink }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(0);
  const problem = senderProblem(name, email);
  const fields = useMemo(() => ({ name: name.trim(), email: email.trim() }), [name, email]);

  return (
    <main className="ul-shell" style={accentStyle(link.branding?.brand_color)}>
      <header className="ul-studio">
        <StudioMark branding={{ studio_name: link.studio_name, logo_url: link.branding?.logo_url ?? null }} size={36} />
        <div><strong>{link.studio_name}</strong><small>File request</small></div>
      </header>

      <section className="ul-card" aria-labelledby="ul-title">
        <div className="ul-intro">
          <p className="ul-eyebrow">{link.project_name}</p>
          <h1 id="ul-title">{link.label}</h1>
          {link.instructions && <p className="ul-instructions">{link.instructions}</p>}
          <div className="ul-facts">
            {link.due_at && <span><CalendarClock size={13} aria-hidden="true" />Please send by {shortDateTime(link.due_at)}</span>}
            {link.expires_at && <span><Lock size={13} aria-hidden="true" />Link closes {shortDateTime(link.expires_at)}</span>}
          </div>
        </div>

        <div className="ul-grid">
          <form className="ul-sender" onSubmit={(event) => event.preventDefault()} aria-label="Who is sending">
            <h2>Your details</h2>
            <label>Name<input name="name" autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Rachel Kim" maxLength={120} required /></label>
            <label>Email<input name="email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="rachel@brand.com" maxLength={255} required /></label>
            <p className="ul-muted">Only {link.studio_name} sees these, next to the files you send.</p>
          </form>

          <div className="ul-files">
            <DropUploader
              url={publicUploadUrl(token)}
              fields={fields}
              accept={link.accept}
              maxBytes={link.max_file_bytes}
              allowedKinds={link.allowed_kinds}
              blockedReason={problem}
              onSent={setSent}
              title="Drag files here to send"
            />
            {sent > 0 && (
              <p className="ul-done" role="status"><CircleCheckBig size={15} aria-hidden="true" />
                {sent === 1 ? "1 file is" : `${sent} files are`} with {link.studio_name}. You can keep adding more.
              </p>
            )}
          </div>
        </div>
      </section>
      <footer className="ul-foot">Files go straight to {link.studio_name}&rsquo;s project. Powered by <strong>Blaze Flow</strong></footer>
    </main>
  );
}
