import { loadSession } from "@/lib/session";
import { loadWorkspaceContext } from "@/lib/workspace";
import { NotificationsList } from "./list";

/**
 * Every notification for the selected workspace, with All / Unread filters and paging.
 * The filter and page live in the URL (`?filter=unread&page=2`) so a view can be linked
 * and the back button behaves.
 */
export default async function NotificationsPage({ searchParams }: PageProps<"/notifications">) {
  const params = await searchParams;
  await loadSession();
  const context = await loadWorkspaceContext();
  const workspace = context.ok ? context.data.selected : null;
  const filter = params.filter === "unread" ? "unread" : "all";
  const rawPage = Number(typeof params.page === "string" ? params.page : "1");
  const page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1;
  return <NotificationsList key={`${filter}:${page}`} workspaceId={workspace?.id ?? null} workspaceName={workspace?.name ?? null} filter={filter} page={page} />;
}
