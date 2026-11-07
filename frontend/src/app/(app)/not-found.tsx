import { NotFoundPanel } from "@/components/not-found/not-found-panel";

/** 404 inside the app shell, so the sidebar is still there to navigate away. */
export default function NotFound() {
  return <NotFoundPanel />;
}
