import type { Metadata } from "next";
import { AppToaster } from "@/components/app-toaster";
import { GuestReviewer } from "./reviewer";
// The guest page reuses the team review player and the shared confirm dialog.
import "../(app)/review/review.css";
import "../(app)/tasks/tasks.css";
import "./guest.css";

export const metadata: Metadata = {
  title: "Review · Krewsys",
  description: "Review a cut and leave notes.",
  // A review link is a bearer credential in a query string; keep it out of search results.
  robots: { index: false, follow: false },
};

/**
 * The public landing page for a client review link.
 *
 * Deliberately outside `AppShell` and `loadSession`: a guest has no workspace, no
 * membership, and no session cookie, so none of the signed-in chrome applies. The token
 * is read here and handed to the client component, which exchanges it for an access key.
 */
export default async function GuestReview({ searchParams }: PageProps<"/guest-review">) {
  const params = await searchParams;
  const token = typeof params.token === "string" ? params.token : "";
  // A link shared for one file carries that file's review version, so it opens on it.
  const cut = typeof params.cut === "string" ? params.cut : null;
  return (
    <>
      <GuestReviewer token={token} cut={cut} />
      {/* Outside the signed-in layout, so this is the page's only toaster (player notices). */}
      <AppToaster />
    </>
  );
}
