import type { Metadata } from "next";
import { pageTitle, siteConfig } from "./site-config";

/**
 * Metadata for one public page, all derived from `siteConfig`. The Open Graph image is
 * rendered by `app/og.png/route.tsx`.
 */
export const OG_IMAGE = { url: "/og.png", width: 1200, height: 630, alt: `${siteConfig.name}: ${siteConfig.tagline}` };

export function marketingMetadata({ title, description, path }: { title?: string; description?: string; path: string }): Metadata {
  const fullTitle = pageTitle(title);
  const desc = description ?? siteConfig.description;
  return {
    title: fullTitle,
    description: desc,
    alternates: { canonical: path },
    openGraph: {
      type: "website",
      siteName: siteConfig.name,
      title: fullTitle,
      description: desc,
      url: path,
      locale: "en_GB",
      images: [OG_IMAGE],
    },
    twitter: { card: "summary_large_image", title: fullTitle, description: desc, images: [OG_IMAGE.url] },
  };
}
