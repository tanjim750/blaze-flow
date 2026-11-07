import type { Metadata } from "next";
import { ProFooter } from "@/components/pro/pro-footer";
import { ProHeader } from "@/components/pro/pro-header";
import { ProMotion } from "@/components/pro/pro-motion";
import { siteConfig } from "@/lib/site-config";
import "./pro.css";

/* Type: Geist, the app's own font, already loaded by the root layout (`--font-geist-sans`). */

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
    <div className="pro">
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
