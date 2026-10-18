import type { ReactNode } from "react";
import { TriangleAlert } from "lucide-react";
import { siteConfig } from "@/lib/site-config";

/** Last edit to the starter legal text. Update when the owner revises any legal page. */
export const LEGAL_UPDATED = "18 October 2026";

/**
 * Wrapper for the privacy, terms and cookies pages. Every one opens with a draft banner:
 * this is starter text written for the product, not reviewed by a lawyer.
 */
export function LegalPage({ title, intro, children }: { title: string; intro: ReactNode; children: ReactNode }) {
  return (
    <>
      <section className="mk-page-hero">
        <div className="mk-wrap">
          <p className="mk-eyebrow">Legal</p>
          <h1>{title}</h1>
          <p>{intro}</p>
        </div>
      </section>
      <section className="mk-section" style={{ paddingTop: 0 }}>
        <div className="mk-wrap mk-legal">
          <div className="mk-draft-banner" role="note" data-testid="legal-draft-banner">
            <TriangleAlert aria-hidden="true" />
            <p><b>Draft for review.</b> This is starter text that the owner of {siteConfig.name} must review and adapt before relying on it. It is not legal advice. Where details are marked “to be confirmed”, they still need filling in.</p>
          </div>
          <div className="mk-prose">
            <p><em>Last updated: {LEGAL_UPDATED}</em></p>
            {children}
          </div>
        </div>
      </section>
    </>
  );
}
