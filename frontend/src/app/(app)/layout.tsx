import { cookies } from "next/headers";
import { AppShell } from "@/components/app-shell";
import { loadSession } from "@/lib/session";
import { toShellUser } from "@/lib/user";
import { loadWorkspaceContext } from "@/lib/workspace";

/**
 * The signed-in chrome, rendered once for every route in this group.
 *
 * It used to live inside each page, which meant navigating anywhere tore the sidebar and
 * topbar down and rebuilt them. Here the shell is a layout, so it persists across
 * navigation and only the page body swaps — which is what `loading.tsx` in this group
 * replaces while the next page resolves.
 *
 * Resolving the session here also keeps the signed-out redirect ahead of any Suspense
 * boundary, so it stays a real HTTP redirect rather than a streamed meta refresh.
 *
 * The sidebar's collapsed state is a cookie rather than `localStorage` so it can be read
 * here, on the server: restoring it after hydration instead would paint a full-width rail
 * and then snap it shut on every load.
 */
export default async function AppLayout({ children }: LayoutProps<"/">) {
  const [session, context, jar] = await Promise.all([loadSession(), loadWorkspaceContext(), cookies()]);
  return (
    <AppShell
      user={session.user && toShellUser(session.user)}
      workspaces={context.ok ? context.data.workspaces : []}
      selectedWorkspaceId={context.ok ? context.data.selected?.id : null}
      railCollapsed={jar.get("blazeflow_rail")?.value === "1"}
    >
      {children}
    </AppShell>
  );
}
