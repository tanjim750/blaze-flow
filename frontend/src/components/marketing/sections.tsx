import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, Check, Plus } from "lucide-react";
import { siteConfig } from "@/lib/site-config";
import { cn } from "@/lib/utils";
import { Marked, Rise, Scribble, Tilt } from "./playful";
import { STROKES } from "./strokes";
import { Screenshot, type ScreenKey } from "./screenshot";

export type Tone = "sun" | "tomato" | "mint" | "sky" | "pink";

export function PrimaryCtas({ secondary = "login", className }: { secondary?: "login" | "features"; className?: string }) {
  return (
    <div className={cn("mk-ctas", className)}>
      <Link className="mk-btn" href={siteConfig.links.signUp}>
        Start your {siteConfig.pricing.trialDays}-day free trial <ArrowRight aria-hidden="true" />
      </Link>
      {secondary === "login"
        ? <Link className="mk-btn is-ghost" href={siteConfig.links.signIn}>Log in</Link>
        : <Link className="mk-btn is-ghost" href="/features">See every feature</Link>}
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

/** The opening of every inner page: a sticker eyebrow, a big condensed headline, floating clay. */
export function PageHero({ eyebrow, title, lede, tone = "sun" }: { eyebrow: string; title: ReactNode; lede: ReactNode; tone?: Tone }) {
  return (
    <section className={cn("mk-page-hero", `is-${tone}`)}>
      <span className="mk-clay mk-clay-ball is-float" aria-hidden="true" />
      <span className="mk-clay mk-clay-ring is-float" aria-hidden="true" />
      <div className="mk-wrap">
        <p className="mk-eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="mk-page-lede">{lede}</p>
      </div>
    </section>
  );
}

export type FeatureBlockProps = {
  id?: string;
  icon: ReactNode;
  tone?: Tone;
  eyebrow: string;
  title: string;
  body: ReactNode;
  points: string[];
  screen: ScreenKey;
  inset?: ScreenKey;
  caption?: string;
  flipped?: boolean;
  link?: { href: string; label: string };
};

/** Copy beside a taped-down, tilting screenshot on a colour blob; alternates sides. */
export function FeatureBlock({ id, icon, tone = "sun", eyebrow, title, body, points, screen, inset, caption, flipped, link }: FeatureBlockProps) {
  return (
    <article id={id} className={cn("mk-feature", `is-${tone}`, flipped && "is-flipped")} aria-labelledby={id ? `${id}-title` : undefined}>
      <Rise className="mk-feature-copy">
        <span className="mk-feature-icon" aria-hidden="true">{icon}</span>
        <p className="mk-kicker">{eyebrow}</p>
        <h3 id={id ? `${id}-title` : undefined}>{title}</h3>
        <p>{body}</p>
        <ul className="mk-checks">
          {points.map((point) => <li key={point}><Check aria-hidden="true" />{point}</li>)}
        </ul>
        {link && <Link className="mk-link" href={link.href}>{link.label} <ArrowRight aria-hidden="true" /></Link>}
      </Rise>
      <Rise className="mk-feature-media" delay={0.08} rotate={flipped ? 1.5 : -1.5}>
        <Tilt>
          <Screenshot name={screen} caption={caption} sizes="(max-width: 900px) 100vw, 760px" />
        </Tilt>
        {inset && <Screenshot name={inset} variant="card" className="mk-inset" sizes="(max-width: 900px) 52vw, 380px" />}
      </Rise>
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
      <span className="mk-price-hole" aria-hidden="true" />
      <H>Pro <span className="mk-badge">{trialDays}-day free trial</span></H>
      <div className="mk-price-amount"><b>{symbol}{proMonthly}</b><span>per month, in GBP</span></div>
      <p className="mk-muted">Everything {siteConfig.name} does, for your whole studio. Try it free for {trialDays} days, then {symbol}{proMonthly} a month.</p>
      <Link className="mk-btn is-ink" href={siteConfig.links.signUp}>Start free trial</Link>
      <ul className="mk-checks">
        {PRO_FEATURES.map((feature) => <li key={feature}><Check aria-hidden="true" />{feature}</li>)}
      </ul>
    </div>
  );
}

export type FaqItem = { q: string; a: ReactNode };

/** Native <details>, so it works without JavaScript. */
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

export function FinalCta({ title, body }: { title?: ReactNode; body?: string }) {
  return (
    <section className="mk-section mk-final" aria-labelledby="mk-final-cta">
      <div className="mk-wrap">
        <div className="mk-cta">
          <Scribble className="mk-cta-star" viewBox={STROKES.star.viewBox} d={STROKES.star.d} width={4} />
          <h2 id="mk-final-cta">{title ?? <>Go on.<br />Circle <Marked kind="wave">something.</Marked></>}</h2>
          <p>{body ?? `${siteConfig.pricing.trialDays} days free with every feature, then ${siteConfig.pricing.symbol}${siteConfig.pricing.proMonthly} a month. Bring a real project and a fussy client.`}</p>
          <div className="mk-ctas">
            <Link className="mk-btn is-ink" href={siteConfig.links.signUp}>Start your {siteConfig.pricing.trialDays}-day free trial <ArrowRight aria-hidden="true" /></Link>
            <Link className="mk-btn is-ghost" href={siteConfig.links.signIn}>Log in</Link>
          </div>
        </div>
      </div>
    </section>
  );
}
