import { AppShell } from "@/components/app-shell";
import { loadReviewView } from "@/lib/review-view";
import { loadSession } from "@/lib/session";
import { toShellUser } from "@/lib/user";
import { ReviewWorkspace } from "./workspace";
import "./review.css";
import { loadWorkspaceContext } from "@/lib/workspace";

export default async function Review({ searchParams }: PageProps<"/review">) {
  const params = await searchParams;
  const projectId = typeof params.project === "string" ? params.project : undefined;
  const versionId = typeof params.version === "string" ? params.version : undefined;
  const shareOpen = params.share === "1";

  // Redirects to /sign-in when the API says we are unauthenticated.
  const session = await loadSession();
  const view = await loadReviewView({ projectId, versionId });
  const workspaceContext = await loadWorkspaceContext();

  return (
    <AppShell user={session.user && toShellUser(session.user)} workspaces={workspaceContext.ok ? workspaceContext.data.workspaces : []} selectedWorkspaceId={workspaceContext.ok ? workspaceContext.data.selected?.id : null}>
      <ReviewWorkspace view={session.notice ? { ...view, notice: session.notice } : view} currentUserId={session.user?.id ?? null} initialShareOpen={shareOpen} />
    </AppShell>
  );
}
