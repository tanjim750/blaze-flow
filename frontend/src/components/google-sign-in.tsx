"use client";

import { useAppRouter } from "@/lib/app-router";
import Script from "next/script";

import { useEffect, useRef, useState } from "react";
import { signInWithGoogle } from "@/lib/auth-client";

declare global {
  interface Window {
    google?: { accounts: { id: {
      initialize(config: { client_id: string; callback: (response: { credential?: string }) => void; use_fedcm_for_prompt?: boolean }): void;
      renderButton(element: HTMLElement, config: { theme: string; size: string; width: number; shape: string; text?: string; logo_alignment?: string }): void;
    } } };
  }
}

const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;

function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" width="18" height="18" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

/**
 * "Continue with Google" in our own design-system styling. Google's GIS button is rendered
 * on top of it at opacity 0 and sized to our button, so clicks and keyboard activation go
 * to the real GIS button (which keeps the ID-token credential flow verified by the backend)
 * while users only ever see our button. The visual button is presentational; focus lands on
 * the GIS iframe and the slot shows a single focus ring (focus events on the iframe, plus :focus-within).
 * Without NEXT_PUBLIC_GOOGLE_CLIENT_ID a disabled look-alike explains why.
 */
export function GoogleSignIn({ destination = "/", inviteToken, label = "Continue with Google" }: { destination?: string; inviteToken?: string; label?: string }) {
  const router = useAppRouter();
  const mount = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [focused, setFocused] = useState(false);
  const initialized = useRef(false);

  function initialize() {
    if (!clientId || !window.google || !mount.current || initialized.current) return;
    initialized.current = true;
    window.google.accounts.id.initialize({
      client_id: clientId,
      use_fedcm_for_prompt: true,
      callback: async ({ credential }) => {
        if (!credential) return setError("Google did not return a sign-in credential. Please try again.");
        setError("");
        setBusy(true);
        const result = await signInWithGoogle(credential, inviteToken);
        if (!result.ok) { setBusy(false); return setError(result.error); }
        router.push(destination);
        router.refresh();
      },
    });
    // GIS caps width at 400px; the overlay stretches the iframe to cover our full button.
    const width = Math.min(400, Math.max(200, Math.round(mount.current.getBoundingClientRect().width)));
    window.google.accounts.id.renderButton(mount.current, { theme: "outline", size: "large", width, shape: "rectangular", text: "continue_with", logo_alignment: "center" });
    setReady(true);
  }

  // Focus moving into the cross-origin GIS iframe does not reliably fire focus events or
  // :focus-within in the parent page, so track document.activeElement instead.
  useEffect(() => {
    const sync = () => setFocused(!!mount.current && mount.current.contains(document.activeElement));
    const events = ["focusin", "focusout", "keyup"] as const;
    events.forEach((e) => document.addEventListener(e, sync));
    window.addEventListener("blur", sync);
    window.addEventListener("focus", sync);
    return () => {
      events.forEach((e) => document.removeEventListener(e, sync));
      window.removeEventListener("blur", sync);
      window.removeEventListener("focus", sync);
    };
  }, []);

  // Remount (client-side navigation between sign-in and sign-up) with GIS already loaded.
  useEffect(() => { if (window.google) initialize(); });

  if (!clientId) {
    return (
      <div className="google-auth">
        <button type="button" className="google-fallback" disabled aria-describedby="google-off">
          <GoogleMark />{label}
        </button>
        <p className="auth-hint" id="google-off">Google sign-in isn’t configured on this server.</p>
      </div>
    );
  }
  return (
    <div className="google-auth" aria-busy={busy || undefined}>
      <Script src="https://accounts.google.com/gsi/client" strategy="afterInteractive" onReady={initialize} />
      <div
        className={`google-slot${ready ? " is-ready" : ""}${busy ? " is-busy" : ""}${focused ? " is-focused" : ""}`}
      >
        <span className="google-fallback google-face" aria-hidden><GoogleMark />{label}</span>
        <div ref={mount} className="google-button" title={label} />
      </div>
      {busy && <p className="auth-hint" role="status">Signing you in with Google…</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
    </div>
  );
}
