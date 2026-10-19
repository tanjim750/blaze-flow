import type { Metadata } from "next";
import { Schibsted_Grotesk } from "next/font/google";
import { ProFooter } from "@/components/pro/pro-footer";
import { ProHeader } from "@/components/pro/pro-header";
import { ProMotion } from "@/components/pro/pro-motion";
import { siteConfig } from "@/lib/site-config";
import "./pro.css";

/*
 * One typeface for the whole homepage, self-hosted by next/font at build time. Schibsted Grotesk
 * is a newspaper grotesk: firm, slightly condensed, and plain enough for body text too.
 */
const sans = Schibsted_Grotesk({ subsets: ["latin"], variable: "--pro-sans", display: "swap" });

/*
 * Two palettes share the same page: light (paper, default) and dark (graphite). For preview,
 * `/?theme=dark` or `/?theme=light` picks one. The page stays static: this runs before first
 * paint and only flips a data attribute, so there is no flash and no hydration mismatch.
 */
const THEME_SCRIPT = `(function(){try{var t=new URLSearchParams(location.search).get("theme");if(t==="dark"||t==="light")document.currentScript.parentElement.setAttribute("data-theme",t)}catch(e){}})()`;

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
    <div className={`pro ${sans.variable}`} data-theme="light" suppressHydrationWarning>
      <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
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
