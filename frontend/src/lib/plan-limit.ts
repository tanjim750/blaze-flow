/** R2: the plan's project limit was hit, so the UI explains it with next steps, not a form error. */
export type PlanLimit = { plan: string; limit: number };

/** Reads the API's "The workspace owner's FREE plan allows up to 3 project(s)…" refusal. */
export function planLimitOf(detail: string): PlanLimit | null {
  const match = /(\w+) plan allows up to (\d+) project/i.exec(detail);
  return match ? { plan: match[1].toUpperCase(), limit: Number(match[2]) } : null;
}
