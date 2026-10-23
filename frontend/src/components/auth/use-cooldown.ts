"use client";

import { useCallback, useEffect, useState } from "react";

/** Seconds-remaining countdown used to rate-limit "resend" buttons on the client. */
export function useCooldown(seconds = 60) {
  const [remaining, setRemaining] = useState(0);
  useEffect(() => {
    if (remaining <= 0) return;
    const timer = setTimeout(() => setRemaining((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [remaining]);
  const start = useCallback(() => setRemaining(seconds), [seconds]);
  return { remaining, active: remaining > 0, start };
}
