"use client";

import { CloudOff, RotateCcw } from "@/components/icons";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";

/** Backoff for the automatic re-render of the shell after a failed identity/workspace load. */
export const RECONNECT_DELAYS_MS = [2_000, 5_000, 10_000, 20_000];

/**
 * Shown when the layout could not load who you are or your workspaces (B8).
 *
 * The app layout persists across client navigation, so a single failed `/auth/me/` or
 * `/workspaces/` used to freeze the shell in a degraded state (generic nav, "PRO" badge,
 * "?" avatar) until a full reload. This re-runs the server render with backoff, and offers
 * an immediate Retry, so the shell heals by itself once the API answers again.
 */
export function ShellReconnect() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [attempt, setAttempt] = useState(0);
  const timer = useRef<number | undefined>(undefined);

  const retry = useCallback(() => {
    startTransition(() => router.refresh());
    setAttempt((n) => n + 1);
  }, [router]);

  useEffect(() => {
    if (attempt >= RECONNECT_DELAYS_MS.length) return;
    timer.current = window.setTimeout(retry, RECONNECT_DELAYS_MS[attempt]);
    return () => window.clearTimeout(timer.current);
  }, [attempt, retry]);

  const exhausted = attempt >= RECONNECT_DELAYS_MS.length;
  return (
    <div className="shell-reconnect" role="status" aria-live="polite">
      <CloudOff size={16} aria-hidden="true" />
      <p>
        <b>Can’t reach Blaze Flow right now.</b>{" "}
        <span>{exhausted ? "Your work is safe. Try again in a moment." : pending ? "Reconnecting…" : "We’ll keep retrying automatically."}</span>
      </p>
      <button type="button" onClick={() => { window.clearTimeout(timer.current); retry(); }} disabled={pending} aria-busy={pending}>
        <RotateCcw size={14} aria-hidden="true" className={pending ? "is-spinning" : ""} />{pending ? "Retrying…" : "Retry"}
      </button>
    </div>
  );
}
