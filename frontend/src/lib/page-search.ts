/**
 * "Only ever one search bar per screen." A page that draws its own search bar (the Files
 * toolbar) registers here while mounted; the app shell then hides its header search entry.
 */
import { useEffect, useSyncExternalStore } from "react";

let mounted = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

export function usePageSearchPresent() {
  return useSyncExternalStore(subscribe, () => mounted > 0, () => false);
}
export function useRegisterPageSearch(active = true) {
  useEffect(() => {
    if (!active) return;
    mounted += 1; emit();
    return () => { mounted -= 1; emit(); };
  }, [active]);
}
