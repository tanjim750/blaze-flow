import type { Metadata } from "next";
import { Bricolage_Grotesque, Caveat } from "next/font/google";
import { MarketingMotion } from "@/components/marketing/playful";
import { SiteFooter } from "@/components/marketing/site-footer";
import { SiteHeader } from "@/components/marketing/site-header";
import { siteConfig } from "@/lib/site-config";
import "./marketing.css";

/*
 * The public site's two typefaces, self-hosted by next/font at build time (no request to
 * Google at runtime). Bricolage Grotesque is variable in width and optical size, so one file
 * covers both the condensed display headlines and the body text. Caveat is the handwriting.
 */
const display = Bricolage_Grotesque({ subsets: ["latin"], axes: ["wdth", "opsz"], variable: "--mk-display", display: "swap" });
const hand = Caveat({ subsets: ["latin"], weight: ["600", "700"], variable: "--mk-hand", display: "swap", preload: false });

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
    <div className={`mk ${display.variable} ${hand.variable}`}>
      {/* Without JavaScript, nothing should stay parked in its pre-entrance state. */}
      <noscript><style>{`.mk [style*="opacity:0"],.mk [style*="opacity: 0"]{opacity:1!important;transform:none!important}`}</style></noscript>
      <a className="mk-skip" href="#main">Skip to content</a>
      <MarketingMotion>
        <SiteHeader />
        <main id="main">{children}</main>
        <SiteFooter />
      </MarketingMotion>
    </div>
  );
}
