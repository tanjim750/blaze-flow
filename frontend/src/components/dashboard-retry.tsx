"use client";

import { RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

/** Re-runs the dashboard's server render. The page refetches everything on refresh. */
export function DashboardRetry() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return <button type="button" className="home-retry" disabled={pending} aria-busy={pending} onClick={() => startTransition(() => router.refresh())}>
    <RotateCcw size={14} aria-hidden="true" className={pending ? "is-spinning" : ""} />{pending ? "Retrying…" : "Retry"}
  </button>;
}
