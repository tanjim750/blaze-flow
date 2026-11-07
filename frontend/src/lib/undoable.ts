/**
 * A decision with a short Undo window (R15). Approve / Request changes are records the team
 * and client are notified about, so rather than writing and then trying to unwind them, the
 * write waits `delayMs`: Undo inside the window cancels it outright, nothing is sent. Leaving
 * the page (or anything calling `flush`) commits straight away so a decision is never lost.
 */
export type Undoable = { undo: () => boolean; flush: () => void; settled: () => boolean };

export type Timers = { set: (fn: () => void, ms: number) => unknown; clear: (handle: unknown) => void };
// Wrapped so the globals are never called as methods of another object ("Illegal invocation").
const browserTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export function scheduleUndoable(commit: () => void, delayMs: number, timers: Timers = browserTimers): Undoable {
  let done = false;
  const fire = () => { if (done) return; done = true; timers.clear(handle); commit(); };
  const handle = timers.set(fire, delayMs);
  return {
    undo: () => { if (done) return false; done = true; timers.clear(handle); return true; },
    flush: fire,
    settled: () => done,
  };
}

export const DECISION_UNDO_MS = 5000;
