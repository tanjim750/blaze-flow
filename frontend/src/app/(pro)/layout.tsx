import type { Metadata } from "next";
import { Hanken_Grotesk, Source_Serif_4 } from "next/font/google";
import { ProFooter } from "@/components/pro/pro-footer";
import { ProHeader } from "@/components/pro/pro-header";
import { ProMotion } from "@/components/pro/pro-motion";
import { siteConfig } from "@/lib/site-config";
import "./pro.css";

/*
 * Homepage typefaces, self-hosted by next/font at build time.
 * - Source Serif 4 (display optical size) for headlines: a sober book serif with real contrast
 *   at large sizes.
 * - Hanken Grotesk for everything else: interface labels, body text and numbers.
 */
const serif = Source_Serif_4({ subsets: ["latin"], axes: ["opsz"], variable: "--pro-serif", display: "swap" });
const sans = Hanken_Grotesk({ subsets: ["latin"], variable: "--pro-sans", display: "swap" });

/**
 * Chrome for the public homepage (served at `/` to signed-out visitors, see `src/proxy.ts`).
 * It has its own header and footer; the other public pages keep `(marketing)/layout.tsx`.
 */
export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.url),
  applicationName: siteConfig.name,
  robots: { index: true, follow: true },
};

export default function ProLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`pro ${serif.variable} ${sans.variable}`}>
      {/* Without JavaScript, nothing should stay parked in its pre-entrance state. */}
      <noscript><style>{`.pro [style*="opacity:0"],.pro [style*="opacity: 0"]{opacity:1!important;transform:none!important}`}</style></noscript>
      <a className="pro-skip" href="#main">Skip to content</a>
      <ProMotion>
        <ProHeader />
        <main id="main">{children}</main>
        <ProFooter />
      </ProMotion>
    </div>
  );
}
