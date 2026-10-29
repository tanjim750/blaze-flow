import { PageLoader } from "@/components/brand/page-loader";

/** Initial-load splash: full-screen Krewsys loader, revealed only after ~300ms. */
export default function Loading() { return <PageLoader fullscreen />; }
