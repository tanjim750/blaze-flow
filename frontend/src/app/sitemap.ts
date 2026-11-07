import type { MetadataRoute } from "next";
import { publicRoutes, siteConfig } from "@/lib/site-config";

/** Public marketing pages only; nothing behind sign-in is listed. */
export default function sitemap(): MetadataRoute.Sitemap {
  return publicRoutes.map((route) => ({
    url: `${siteConfig.url}${route.path === "/" ? "" : route.path}`,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));
}
