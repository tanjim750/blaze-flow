import { redirect } from "next/navigation";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * The old chrome-free review used by the split pane. Review now always opens as the full
 * page (the narrow pane collapsed the player at laptop widths), so any saved or in-flight
 * link to this route is sent to the same cut on `/review`.
 */
export default async function EmbeddedReview({ searchParams }: Props) {
  const params = await searchParams;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (typeof value === "string") query.set(key, value);
  redirect(`/review${query.size ? `?${query.toString()}` : ""}`);
}
