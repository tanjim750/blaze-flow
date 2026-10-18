import type { Metadata } from "next";
import { SiteFooter } from "@/components/marketing/site-footer";
import { SiteHeader } from "@/components/marketing/site-header";
import { siteConfig } from "@/lib/site-config";
import "./marketing.css";

/**
 * Chrome for the public site: home (served at `/` to signed-out visitors, see
 * `src/proxy.ts`), features, pricing, contact and the legal pages. None of these routes
 * touch the session, so they render statically and stay fast.
 */
export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.url),
  applicationName: siteConfig.name,
  robots: { index: true, follow: true },
};

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mk">
      <a className="mk-skip" href="#main">Skip to content</a>
      <SiteHeader />
      <main id="main">{children}</main>
      <SiteFooter />
    </div>
  );
}
