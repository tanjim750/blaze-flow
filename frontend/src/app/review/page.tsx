import { AppShell } from "@/components/app-shell";
import { loadReviewView } from "@/lib/review-view";
import { loadSession } from "@/lib/session";
import { toShellUser } from "@/lib/user";
import { ReviewWorkspace } from "./workspace";
import "./review.css";

export default async function Review({ searchParams }: PageProps<"/review">) {
  const params = await searchParams;
  const projectId = typeof params.project === "string" ? params.project : undefined;
  const versionId = typeof params.version === "string" ? params.version : undefined;

  // Redirects to /sign-in when the API says we are unauthenticated.
  const session = await loadSession();
  const view = await loadReviewView({ projectId, versionId });

  return (
    <AppShell user={session.user && toShellUser(session.user)}>
      <ReviewWorkspace view={session.notice ? { ...view, notice: session.notice } : view} />
    </AppShell>
  );
}
