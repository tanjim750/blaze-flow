"use client";

import { useEffect, useRef } from "react";
import { Keyboard, X } from "lucide-react";
import { REVIEW_SHORTCUTS } from "@/lib/review-shortcuts";

/** The `?` overlay: every review shortcut, grouped. Esc, the close button or the backdrop close it. */
export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const close = useRef<HTMLButtonElement>(null);
  const opener = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement;
    close.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" || event.key === "?") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      // Focus goes back to whatever opened it, so the keyboard user is not dropped at the top.
      if (opener.current instanceof HTMLElement) opener.current.focus();
    };
  }, [onClose, open]);

  if (!open) return null;
  return (
    <div className="rv-keys-backdrop" onClick={onClose}>
      <section
        className="rv-keys"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rv-keys-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header>
          <h2 id="rv-keys-title"><Keyboard size={15} aria-hidden="true" />Keyboard shortcuts</h2>
          <button ref={close} type="button" onClick={onClose} aria-label="Close shortcuts"><X size={15} /></button>
        </header>
        <div className="rv-keys-groups">
          {REVIEW_SHORTCUTS.map((group) => (
            <div key={group.title} className="rv-keys-group">
              <h3>{group.title}</h3>
              <dl>
                {group.items.map((item) => (
                  <div key={`${group.title}-${item.label}`}>
                    <dt>{item.keys.map((key, index) => <span key={key}>{index > 0 && <i>{item.either ? "/" : "+"}</i>}<kbd>{key}</kbd></span>)}</dt>
                    <dd>{item.label}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
        <p className="rv-keys-foot">Shortcuts pause while you type in a field. Press <kbd>?</kbd> any time to see this again.</p>
      </section>
    </div>
  );
}
