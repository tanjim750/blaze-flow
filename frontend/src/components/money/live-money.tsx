"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { LIVE_MONEY_MS, moneyToastText, moneyVersionPath, nextMoneyStep, type MoneyPulse } from "@/lib/live-money";

/**
 * Keeps money on screen current without a reload: dashboard cards, the Money page and editor
 * earnings are server-rendered, so a changed money version just calls router.refresh().
 * Polls only while the tab is visible and catches up the moment it comes back. Renders nothing.
 */
export function LiveMoney({ workspaceId, intervalMs = LIVE_MONEY_MS }: { workspaceId: string | null; intervalMs?: number }) {
  const router = useRouter();
  const last = useRef<MoneyPulse | null>(null);
  const stopped = useRef(false);

  useEffect(() => {
    last.current = null;
    stopped.current = false;
    if (!workspaceId) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let controller: AbortController | null = null;

    const check = async () => {
      controller?.abort();
      controller = new AbortController();
      try {
        const response = await fetch(moneyVersionPath(workspaceId), { credentials: "include", cache: "no-store", signal: controller.signal });
        // No money here for this viewer (client team, removed): stop asking.
        if (response.status === 403 || response.status === 404) { stopped.current = true; return; }
        if (!response.ok) return;
        const pulse = await response.json() as MoneyPulse;
        const step = nextMoneyStep(last.current, pulse);
        last.current = pulse;
        if (step.refresh) router.refresh();
        if (step.toast) toast.success(moneyToastText(step.toast), { id: `money-${step.toast.id}` });
      } catch {
        // Offline or aborted: try again next tick.
      }
    };
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      if (stopped.current || document.visibilityState !== "visible") return;
      timer = setTimeout(async () => { await check(); schedule(); }, intervalMs);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible" && !stopped.current) void check().then(schedule);
      else schedule();
    };
    void check().then(schedule);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      if (timer) clearTimeout(timer);
      controller?.abort();
    };
  }, [workspaceId, intervalMs, router]);

  return null;
}
