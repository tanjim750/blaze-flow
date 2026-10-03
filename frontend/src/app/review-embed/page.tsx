import { ReviewWorkspace } from "@/app/(app)/review/workspace";
import { loadReviewView, timeParam } from "@/lib/review-view";
import { loadSession } from "@/lib/session";
import { displayName } from "@/lib/user";
import "../(app)/review/review.css";
import "./review-embed.css";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * A chrome-free version of Review used by the universal split pane.
 *
 * It deliberately loads the same ReviewView and renders the same ReviewWorkspace as
 * `/review`; the iframe is only a layout boundary, not a second implementation or a copy
 * of the media/review data.
 */
export default async function EmbeddedReview({ searchParams }: Props) {
  const params = await searchParams;
  const single = (key: string) => (typeof params[key] === "string" ? params[key] : undefined);
  const session = await loadSession();
  const view = await loadReviewView({
    mediaId: single("media"),
    projectId: single("project"),
    versionId: single("version"),
    compareId: single("compare"),
  });

  return (
    <main className="review-embed">
      <ReviewWorkspace
        // A fresh workspace per cut: composer text, a pending drawing and player state
        // belong to the version they were made on, never to the next one opened.
        key={view.version?.id ?? "none"}
        userId={session.user?.id ?? null}
        view={session.notice ? { ...view, notice: session.notice } : view}
        author={session.user ? displayName(session.user) : "You"}
        initialShareOpen={single("share") === "1"}
        initialCommentId={single("comment") ?? null}
        initialTimeMs={timeParam(single("t"))}
        embedded
      />
    </main>
  );
}
