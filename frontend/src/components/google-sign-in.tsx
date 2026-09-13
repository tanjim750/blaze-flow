"use client";

import Script from "next/script";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { signInWithGoogle } from "@/lib/auth-client";

declare global {
  interface Window {
    google?: { accounts: { id: {
      initialize(config: { client_id: string; callback: (response: { credential?: string }) => void; use_fedcm_for_prompt?: boolean }): void;
      renderButton(element: HTMLElement, config: { theme: string; size: string; width: number; shape: string }): void;
    } } };
  }
}

const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;

export function GoogleSignIn({ destination = "/" }: { destination?: string }) {
  const router = useRouter();
  const mount = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  const initialized = useRef(false);

  function initialize() {
    if (!clientId || !window.google || !mount.current || initialized.current) return;
    initialized.current = true;
    window.google.accounts.id.initialize({
      client_id: clientId,
      use_fedcm_for_prompt: true,
      callback: async ({ credential }) => {
        if (!credential) return setError("Google did not return a sign-in credential.");
        setError("");
        const result = await signInWithGoogle(credential);
        if (!result.ok) return setError(result.error);
        router.push(destination);
        router.refresh();
      },
    });
    window.google.accounts.id.renderButton(mount.current, { theme: "filled_black", size: "large", width: 360, shape: "rectangular" });
  }

  if (!clientId) return <p className="auth-hint google-disabled">Google sign-in needs NEXT_PUBLIC_GOOGLE_CLIENT_ID.</p>;
  return <div className="google-auth">
    <Script src="https://accounts.google.com/gsi/client" strategy="afterInteractive" onReady={initialize} />
    <div ref={mount} className="google-button" />
    {error && <p className="form-error" role="alert">{error}</p>}
  </div>;
}
