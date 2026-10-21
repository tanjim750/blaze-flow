import { PageSkeleton } from "@/components/page-skeleton";

/** Shown at once on navigation (and on slow networks) while the server renders the page. */
export default function Loading() { return <PageSkeleton shape="board" />; }
