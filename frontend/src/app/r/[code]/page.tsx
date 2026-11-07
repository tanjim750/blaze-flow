import type { Metadata } from "next";
import { AppToaster } from "@/components/app-toaster";
import { GuestReviewer } from "@/app/guest-review/reviewer";
import { isShortCode } from "@/lib/short-link";
import "../../(app)/review/review.css";
import "../../(app)/tasks/tasks.css";
import "../../guest-review/guest.css";

export const metadata: Metadata = {
  title: "Review · Krewsys",
  description: "Review a cut and leave notes.",
  // The code is a bearer credential; keep it out of search results.
  robots: { index: false, follow: false },
};

/**
 * A short guest review link, `/r/<code>`. Renders the same guest review as
 * `/guest-review?token=` in place, so the address bar keeps the short link and the long
 * token never appears. The code is redeemed exactly like a token (same expiry, revoke and
 * permission checks, rate-limited on the API); a single-file link's cut comes back from
 * that exchange.
 */
export default async function ShortGuestReview({ params }: PageProps<"/r/[code]">) {
  const { code } = await params;
  return (
    <>
      <GuestReviewer token={isShortCode(code) ? code : ""} cut={null} />
      <AppToaster />
    </>
  );
}
