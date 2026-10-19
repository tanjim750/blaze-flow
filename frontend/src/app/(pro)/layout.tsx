import type { Metadata } from "next";
import { JetBrains_Mono, Newsreader, Schibsted_Grotesk } from "next/font/google";
import { ProFooter } from "@/components/pro/pro-footer";
import { ProHeader } from "@/components/pro/pro-header";
import { ProMotion } from "@/components/pro/pro-motion";
import { siteConfig } from "@/lib/site-config";
import "./pro.css";

/*
 * The homepage's typefaces, self-hosted by next/font at build time.
 * - Schibsted Grotesk: a newspaper-born grotesk with a firm, slightly condensed rhythm. It sets
 *   every headline and the interface text.
 * - Newsreader: an editorial serif with optical sizes, used only for ledes and longer reading,
 *   so the page reads like a well-made trade publication rather than a template.
 * - JetBrains Mono: timecodes, labels and spec lines, the vocabulary of an edit suite.
 */
const sans = Schibsted_Grotesk({ subsets: ["latin"], variable: "--pro-sans", display: "swap" });
const serif = Newsreader({ subsets: ["latin"], axes: ["opsz"], style: ["normal", "italic"], variable: "--pro-serif", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--pro-mono", display: "swap", preload: false });

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
    <div className={`pro ${sans.variable} ${serif.variable} ${mono.variable}`}>
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
