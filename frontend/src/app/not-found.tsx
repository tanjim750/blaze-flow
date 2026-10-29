import type { Metadata } from "next";
import { NotFoundPanel } from "@/components/not-found/not-found-panel";

export const metadata: Metadata = { title: "Page not found · Krewsys" };

/** Fallback 404 for routes outside the signed-in app (dark, branded, with a way back). */
export default function NotFound() {
  return <main className="flex-1"><NotFoundPanel standalone /></main>;
}
