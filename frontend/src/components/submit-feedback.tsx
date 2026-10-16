"use client";

import { useEffect } from "react";

/**
 * A spinner on whichever button submitted a form, for as long as that form is working.
 *
 * Most forms here already disable their submit button while saving (`disabled={pending}`),
 * but a disabled button looks the same as an unavailable one, so a slow save read as a dead
 * click. This watches submits app-wide: the submitter gets `aria-busy` (styled in
 * interactions.css) while it stays disabled, and loses it when it is enabled again, is
 * removed, or the page moves on. A submit that never disables its button (it failed
 * validation, or finished at once) is cleared on the next frame, so nothing spins for no reason.
 */
export function SubmitFeedback() {
  useEffect(() => {
    const onSubmit = (event: SubmitEvent) => {
      const button = event.submitter;
      if (!(button instanceof HTMLButtonElement) || button.hasAttribute("data-no-busy")) return;
      let observer: MutationObserver | null = null;
      const clear = () => { button.removeAttribute("aria-busy"); observer?.disconnect(); window.clearTimeout(cap); };
      const cap = window.setTimeout(clear, 20_000);
      // Wait a frame for React to apply `disabled`; only a button that is actually busy spins.
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (!button.isConnected || !button.disabled) { clear(); return; }
        button.setAttribute("aria-busy", "true");
        observer = new MutationObserver(() => { if (!button.isConnected || !button.disabled) clear(); });
        observer.observe(button, { attributes: true, attributeFilter: ["disabled"] });
        // Removal from the DOM (dialog closed, page changed) is caught on the parent.
        if (button.parentElement) observer.observe(button.parentElement, { childList: true });
      }));
    };
    document.addEventListener("submit", onSubmit, true);
    return () => document.removeEventListener("submit", onSubmit, true);
  }, []);
  return null;
}
