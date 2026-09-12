import { loadReviewView } from "@/lib/review-view";
import { loadSession } from "@/lib/session";
import { displayName } from "@/lib/user";
import { ReviewWorkspace } from "./workspace";
import "./review.css";

/**
 * The review route.
 *
 * `?media=` is the canonical address: it is the id of the `File` row holding the bytes, so
 * Files, a project's files, a task attachment and the version rail all produce the same
 * URL for the same video — see `lib/review-media.ts`. `?project=` and `?version=` are kept
 * working for links made before that, including the ones the dashboard still builds.
 */
export default async function Review({ searchParams }: PageProps<"/review">) {
  const params = await searchParams;
  const single = (key: string) => (typeof params[key] === "string" ? params[key] : undefined);

  // Redirects to /sign-in when the API says we are unauthenticated.
  const session = await loadSession();
  const view = await loadReviewView({
    mediaId: single("media"),
    projectId: single("project"),
    versionId: single("version"),
  });

  return (
    <ReviewWorkspace
      view={session.notice ? { ...view, notice: session.notice } : view}
      author={session.user ? displayName(session.user) : "You"}
      initialShareOpen={params.share === "1"}
    />
  );
}
