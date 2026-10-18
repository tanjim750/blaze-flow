import type { MetadataRoute } from "next";
import { publicRoutes, siteConfig } from "@/lib/site-config";

/**
 * Crawlers may index the public marketing pages only. Everything else is the signed-in
 * app, guest review links or the platform admin, which have no business in search results
 * (they require a session or a private token anyway).
 */
export const PRIVATE_PREFIXES = [
  "/api/", "/platform", "/review", "/guest-review", "/review-embed", "/upload", "/onboarding",
  "/welcome", "/sign-in", "/sign-up", "/forgot-password", "/reset-password", "/verify-email", "/invite",
  "/chat", "/clients", "/deliverables", "/files", "/help", "/messages", "/money", "/notifications",
  "/portal", "/projects", "/render-queue", "/settings", "/tasks", "/team", "/mockups",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: publicRoutes.map((route) => route.path), disallow: PRIVATE_PREFIXES }],
    sitemap: `${siteConfig.url}/sitemap.xml`,
    host: siteConfig.url,
  };
}
