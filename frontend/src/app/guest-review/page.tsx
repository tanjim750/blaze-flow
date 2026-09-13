import type { Metadata } from "next";
import { GuestReviewer } from "./reviewer";
import "./guest.css";

export const metadata: Metadata = {
  title: "Review · Blaze Flow",
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
  return <GuestReviewer token={token} />;
}
