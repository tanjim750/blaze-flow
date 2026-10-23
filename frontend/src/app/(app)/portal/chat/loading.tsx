import { PageSkeleton } from "@/components/page-skeleton";

/** Shown at once on navigation while the server renders the page. */
export default function Loading() { return <PageSkeleton shape="split" />; }
