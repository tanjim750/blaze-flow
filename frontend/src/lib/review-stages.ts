type StageLike = { id: string; name: string; slug: string };

/**
 * The workflow stage Approve should move a cut into, or null when the workspace has none.
 *
 * The built-in stages include both "Approval" (waiting for sign-off) and "Approved" (signed
 * off). A loose `/approv/` match picked "Approval" because it comes first, so Approve moved
 * the cut *back* to awaiting approval. The slug is the stable identifier — the name can be
 * renamed by the workspace — so it wins, then an exact name, then an unambiguous "done"
 * word. "Approval" on its own is never treated as the approved state.
 */
export function approvalStageId(stages: StageLike[]): string | null {
  const bySlug = stages.find((stage) => stage.slug.trim().toLowerCase() === "approved");
  if (bySlug) return bySlug.id;
  const byName = stages.find((stage) => stage.name.trim().toLowerCase() === "approved");
  if (byName) return byName.id;
  const done = stages.find((stage) => /\b(approved|done|complete(d)?|deliver(ed|y)?)\b/i.test(`${stage.name} ${stage.slug.replaceAll("-", " ")}`));
  return done?.id ?? null;
}
