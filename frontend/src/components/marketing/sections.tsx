import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, Check, Plus } from "lucide-react";
import { siteConfig } from "@/lib/site-config";
import { cn } from "@/lib/utils";
import { Screenshot, type ScreenKey } from "./screenshot";

export function PrimaryCtas({ secondary = "login" }: { secondary?: "login" | "features" }) {
  return (
    <div className="mk-ctas">
      <Link className="ui-button ui-button-primary mk-btn" href={siteConfig.links.signUp}>
        Start your {siteConfig.pricing.trialDays}-day free trial <ArrowRight aria-hidden="true" />
      </Link>
      {secondary === "login"
        ? <Link className="ui-button ui-button-secondary mk-btn" href={siteConfig.links.signIn}>Log in</Link>
        : <Link className="ui-button ui-button-secondary mk-btn" href="/features">See every feature</Link>}
    </div>
  );
}

export function SectionHead({ eyebrow, title, lede, center = false, as: Heading = "h2" }: { eyebrow?: string; title: ReactNode; lede?: ReactNode; center?: boolean; as?: "h1" | "h2" }) {
  return (
    <div className={cn("mk-section-head", center && "is-center")}>
      {eyebrow && <p className="mk-eyebrow">{eyebrow}</p>}
      <Heading>{title}</Heading>
      {lede && <p>{lede}</p>}
    </div>
  );
}

export type FeatureBlockProps = {
  id?: string;
  icon: ReactNode;
  tone?: "violet" | "amber" | "teal" | "green";
  eyebrow: string;
  title: string;
  body: ReactNode;
  points: string[];
  screen: ScreenKey;
  inset?: ScreenKey;
  flipped?: boolean;
  link?: { href: string; label: string };
};

export function FeatureBlock({ id, icon, tone = "violet", eyebrow, title, body, points, screen, inset, flipped, link }: FeatureBlockProps) {
  return (
    <article id={id} className={cn("mk-feature mk-reveal", flipped && "is-flipped")} aria-labelledby={id ? `${id}-title` : undefined}>
      <div className="mk-feature-copy">
        <span className={cn("mk-feature-icon", tone !== "violet" && `is-${tone}`)} aria-hidden="true">{icon}</span>
        <p className="mk-eyebrow">{eyebrow}</p>
        <h3 id={id ? `${id}-title` : undefined}>{title}</h3>
        <p>{body}</p>
        <ul className="mk-checks">
          {points.map((point) => <li key={point}><Check aria-hidden="true" />{point}</li>)}
        </ul>
        {link && <Link className="mk-link" href={link.href}>{link.label} <ArrowRight aria-hidden="true" /></Link>}
      </div>
      <div className="mk-feature-media">
        <Screenshot name={screen} sizes="(max-width: 900px) 100vw, 820px" />
        {inset && <Screenshot name={inset} className="mk-inset" sizes="(max-width: 900px) 52vw, 400px" />}
      </div>
    </article>
  );
}

export const PRO_FEATURES = [
  "Review links for clients: no account needed to watch, comment or approve",
  "Frame-accurate comments, drawings, voice and screen notes",
  "Versions, side-by-side compare and one-click approvals",
  "AI Visual QA: proofread posters and videos against approved copy",
  "Branded client portal with deliverables and sign-off records",
  "Files, tasks, project chat and invoices in one workspace",
  "Uploads up to 1 GB per file, with a background upload tray",
];

export function ProPriceCard({ headingLevel: H = "h3" }: { headingLevel?: "h2" | "h3" }) {
  const { symbol, proMonthly, trialDays } = siteConfig.pricing;
  return (
    <div className="mk-price is-featured">
      <H>Pro <span className="mk-badge">{trialDays}-day free trial</span></H>
      <div className="mk-price-amount"><b>{symbol}{proMonthly}</b><span>per month</span></div>
      <p className="mk-muted">Everything {siteConfig.name} does, for your whole studio. Try it free for {trialDays} days, then {symbol}{proMonthly} a month.</p>
      <Link className="ui-button ui-button-primary mk-btn" href={siteConfig.links.signUp}>Start free trial</Link>
      <ul className="mk-checks">
        {PRO_FEATURES.map((feature) => <li key={feature}><Check aria-hidden="true" />{feature}</li>)}
      </ul>
    </div>
  );
}

export type FaqItem = { q: string; a: ReactNode };

export function Faq({ items }: { items: FaqItem[] }) {
  return (
    <div className="mk-faq">
      {items.map((item) => (
        <details key={item.q}>
          <summary>{item.q}<Plus aria-hidden="true" /></summary>
          <div>{item.a}</div>
        </details>
      ))}
    </div>
  );
}

export function FinalCta({ title, body }: { title?: string; body?: string }) {
  return (
    <section className="mk-section" aria-labelledby="mk-final-cta">
      <div className="mk-wrap">
        <div className="mk-cta mk-reveal">
          <p className="mk-eyebrow">Ready when your next cut is</p>
          <h2 id="mk-final-cta">{title ?? "Stop chasing feedback. Start shipping approved work."}</h2>
          <p>{body ?? `Bring one live project into ${siteConfig.name} and run it end to end. ${siteConfig.pricing.trialDays} days free, then ${siteConfig.pricing.symbol}${siteConfig.pricing.proMonthly} a month.`}</p>
          <PrimaryCtas />
        </div>
      </div>
    </section>
  );
}
