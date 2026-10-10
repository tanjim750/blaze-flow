import { redirect } from "next/navigation";
import { getCurrentUser } from "./api";
import type { CurrentUser } from "./api";

/**
 * Resolves who is signed in, and decides what an unauthenticated page should do.
 *
 * The two failure modes are deliberately kept apart:
 *
 * - **Not signed in** (401/403) — the API is answering and says no. There is nothing
 *   useful to render, so the page redirects to `/sign-in`.
 * - **API unreachable** (status 0) — Django is not running. Redirecting would be a lie,
 *   since we have no idea whether the visitor is signed in, so the page keeps its demo
 *   content and shows `notice` instead. This preserves the existing behaviour of
 *   `loadProjectsView`, which is what makes the UI reviewable with no backend at all.
 */
export type Session =
  | { user: CurrentUser; notice: null }
  | { user: null; notice: string };

export async function loadSession(): Promise<Session> {
  const me = await getCurrentUser();
  if (me.ok) return { user: me.data, notice: null };
  if (me.error.status === 401 || me.error.status === 403) redirect("/sign-in");
  return {
    user: null,
    notice: `${me.error.detail} Showing demo content until the API is running.`,
  };
}
