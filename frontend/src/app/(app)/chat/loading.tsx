import { PageLoader } from "@/components/brand/page-loader";

/** Route loading: branded Krewsys loader, revealed only if rendering takes longer than ~300ms. */
export default function Loading() { return <PageLoader />; }
