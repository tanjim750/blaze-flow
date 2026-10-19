"use client";

import { useRef, useState, type ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { motion, useMotionValueEvent, useScroll, useSpring, useTransform, type MotionValue } from "motion/react";
import { ArrowRight, Check } from "lucide-react";
import { DemoVideo } from "@/components/marketing/demo-video";
import { useLiteMotion, useReducedMotionSafe } from "@/components/marketing/motion-prefs";
import { SCREENS, type ScreenKey } from "@/components/marketing/screenshot";
import { PRO_FEATURES, type FaqItem } from "@/components/marketing/sections";
import { siteConfig } from "@/lib/site-config";
import { cn } from "@/lib/utils";

const { name } = siteConfig;
const { symbol, proMonthly, trialDays, currency } = siteConfig.pricing;
const EASE = [0.22, 1, 0.36, 1] as const;

/* ---------- small building blocks ---------- */

/** One short fade-and-rise the first time something enters the viewport. Nothing loops. */
function Reveal({ children, className, delay = 0, as = "div" }: { children: ReactNode; className?: string; delay?: number; as?: "div" | "li" | "article" }) {
  const reduce = useReducedMotionSafe();
  const Tag = motion[as];
  return (
    <Tag
      className={className}
      initial={reduce ? false : { opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "0px 0px -12% 0px" }}
      transition={{ duration: 0.7, ease: EASE, delay }}
    >
      {children}
    </Tag>
  );
}

/** A real screenshot at full resolution. Lazy unless `eager`. */
function Shot({ name: key, eager = false, sizes = "(max-width: 960px) 100vw, 760px", className }: { name: ScreenKey; eager?: boolean; sizes?: string; className?: string }) {
  const screen = SCREENS[key];
  return (
    <Image
      className={className}
      src={screen.src}
      alt={screen.alt}
      width={1920}
      height={1200}
      sizes={sizes}
      {...(eager ? { preload: true, fetchPriority: "high" as const } : { loading: "lazy" as const })}
    />
  );
}

/**
 * A 1:1 detail cropped out of a real screenshot (coordinates in the 1280×800 capture space),
 * so a panel can be shown at a readable size without a separate asset.
 */
function Crop({ name: key, x, y, w, h, width }: { name: ScreenKey; x: number; y: number; w: number; h: number; width: number }) {
  const scale = width / w;
  return (
    <div className="pro-crop" style={{ width, height: Math.round(h * scale) }}>
      <Image
        src={SCREENS[key].src}
        alt=""
        width={1920}
        height={1200}
        sizes={`${Math.round(1280 * scale)}px`}
        loading="lazy"
        style={{ width: 1280 * scale, height: 800 * scale, transform: `translate(${-x * scale}px, ${-y * scale}px)` }}
      />
    </div>
  );
}

function Kicker({ children }: { children: ReactNode }) {
  return <p className="pro-kicker">{children}</p>;
}

function Ctas({ secondary }: { secondary?: { href: string; label: string } }) {
  return (
    <div className="pro-ctas">
      <Link className="pro-btn" href={siteConfig.links.signUp}>Start {trialDays}-day free trial <ArrowRight aria-hidden="true" /></Link>
      {secondary && <Link className="pro-btn is-ghost" href={secondary.href}>{secondary.label}</Link>}
    </div>
  );
}

/** The recurring motif: an edit-suite ruler with timecodes and note markers. */
function Ruler({ playhead, marks = [] }: { playhead?: MotionValue<string>; marks?: number[] }) {
  return (
    <div className="pro-ruler" aria-hidden="true">
      <div className="pro-ruler-ticks" />
      {marks.map((at) => <span key={at} className="pro-ruler-mark" style={{ left: `${at}%` }} />)}
      {playhead && <motion.span className="pro-ruler-head" style={{ left: playhead }} />}
    </div>
  );
}

/* ---------- hero ---------- */

export function ProHero() {
  const stage = useRef<HTMLDivElement>(null);
  const lite = useLiteMotion();
  const { scrollYProgress } = useScroll({ target: stage, offset: ["start end", "start 12%"] });
  const p = useSpring(scrollYProgress, { stiffness: 140, damping: 32, mass: 0.35 });
  const rotateX = useTransform(p, [0, 1], [26, 0]);
  const scale = useTransform(p, [0, 1], [0.9, 1]);
  const y = useTransform(p, [0, 1], [24, 0]);
  const floatY = useTransform(p, [0, 1], [70, -10]);
  const playhead = useTransform(p, [0, 1], ["6%", "58%"]);

  return (
    <section className="pro-hero" aria-labelledby="pro-hero-title">
      <div className="pro-wrap">
        <Kicker><span className="pro-rec" aria-hidden="true" />Review and delivery for post-production</Kicker>
        <h1 id="pro-hero-title" className="pro-h1">
          <span>Every note on the frame.</span> <span className="is-dim">Every <span className="pro-nowrap">sign-off</span> on record.</span>
        </h1>
        <div className="pro-hero-foot">
          <p className="pro-lede">
            {name} is where studios send cuts, posters and stills for review. Clients leave notes on the exact frame, AI checks on-screen
            text against the approved copy, and approved masters go out through a portal with your name on it.
          </p>
          <div className="pro-hero-actions">
            <Ctas secondary={{ href: "#tour", label: "See how it works" }} />
            <p className="pro-fine">Then {symbol}{proMonthly} a month, billed in {currency}. Nothing to install for you or your clients.</p>
          </div>
        </div>
      </div>

      <div className="pro-stage-wrap" ref={stage}>
        <motion.div className="pro-stage" style={lite ? undefined : { rotateX, scale, y }}>
          <div className="pro-window">
            <div className="pro-window-bar">
              <span>Northlight Coffee / Spring Launch — Hero 30s</span>
              <span className="pro-window-tc">V2 · 00:00:14:00</span>
            </div>
            <DemoVideo label={`${name} review page: a client cut playing with time-stamped comments and drawings beside it`} />
          </div>
          <motion.figure className="pro-float" style={lite ? undefined : { y: floatY }}>
            <Crop name="aiqaVideo" x={955} y={218} w={316} h={190} width={330} />
            <figcaption>AI Visual QA, checked against the approved script</figcaption>
          </motion.figure>
        </motion.div>
        <div className="pro-wrap"><Ruler playhead={lite ? undefined : playhead} marks={[12, 21, 27, 44, 57, 66, 81, 88]} /></div>
      </div>
    </section>
  );
}

/* ---------- spec line: specific facts instead of logos we do not have ---------- */

const SPECS = [
  { k: "On the frame", v: "Comments, drawings, voice and screen notes pinned to a frame or a range." },
  { k: "1 GB per file", v: "Masters and proxies upload in a background tray while you keep working." },
  { k: "No client logins", v: "Reviewers open a link to watch, comment and approve. A portal when they want more." },
  { k: `${symbol}${proMonthly} / month`, v: `One Pro plan, with a ${trialDays}-day trial to run a real project through it.` },
];

export function ProSpecs() {
  return (
    <section className="pro-specs" aria-label="At a glance">
      <div className="pro-wrap">
        <ul>
          {SPECS.map((spec, i) => (
            <Reveal as="li" key={spec.k} delay={i * 0.06}>
              <strong>{spec.k}</strong>
              <span>{spec.v}</span>
            </Reveal>
          ))}
        </ul>
      </div>
    </section>
  );
}

/* ---------- statement ---------- */

export function ProStatement() {
  return (
    <section className="pro-statement" aria-labelledby="pro-statement-title">
      <div className="pro-wrap">
        <Reveal>
          <h2 id="pro-statement-title" className="pro-h2 is-xl">
            Feedback arrives as a screenshot in an email, two versions late. <span className="is-dim">{name} ties every note to the frame, the version and the person who wrote it.</span>
          </h2>
        </Reveal>
      </div>
    </section>
  );
}

/* ---------- the tour: sticky product screen, five chapters ---------- */

const CHAPTERS: { key: ScreenKey; label: string; title: string; body: string; points: string[] }[] = [
  {
    key: "review", label: "Review and approval", title: "Notes that land on the exact frame.",
    body: "Open any cut, still or PDF in the review player. Reviewers click a frame or an area of the image, leave a note or a drawing, and approve or request changes on the version they actually watched.",
    points: ["Frame-accurate comments, drawings, voice and screen notes", "Versions side by side, played in sync", "Client-visible or team-only, on every comment"],
  },
  {
    key: "aiqaVideo", label: "AI Visual QA", title: "A proofreader for titles, supers and posters.",
    body: "AI Visual QA reads the text in your artwork and video frames, checks the spelling, and compares it with the copy the client approved. Every finding is outlined on the frame, with its time range on video.",
    points: ["Changed words, prices and dates, and missing lines", "Accept, dismiss, or turn a finding into a comment or task", "Suggestions only. A person confirms every change"],
  },
  {
    key: "portal", label: "Client portal", title: "A home for every client, with your name on it.",
    body: "Invite a client team and they get one place for everything with you: cuts waiting on them, approved work to download, invoices, messages and a form to start the next project.",
    points: ["Your logo, colour and welcome line", "Approved deliverables with a record of who signed off and when", "Clients send files to you, up to 1 GB each"],
  },
  {
    key: "files", label: "Big files", title: "Built for masters, not attachments.",
    body: "Every upload is organised by client and project, with thumbnails, durations and review stage. Filter, search, move and open anything straight into review.",
    points: ["Uploads up to 1 GB per file in a background tray", "Stages show where each file sits in approval", "Grid and list views, folders and filters"],
  },
  {
    key: "tasks", label: "Tasks", title: "Tasks that remember which frame they came from.",
    body: "Turn one note, or a batch of them, into tasks with the version attached. Run the work on a board with your own stages, and carry open notes forward when the next version lands.",
    points: ["Due dates, priorities and overdue warnings", "Filter by assignee, client or due date", "Open notes carried over as a checklist"],
  },
];

export function ProTour() {
  const track = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const { scrollYProgress } = useScroll({ target: track, offset: ["start 45%", "end 55%"] });
  useMotionValueEvent(scrollYProgress, "change", (v) => setActive(Math.min(CHAPTERS.length - 1, Math.max(0, Math.floor(v * CHAPTERS.length)))));

  return (
    <section id="tour" className="pro-tour" aria-labelledby="pro-tour-title">
      <div className="pro-wrap">
        <div className="pro-section-head">
          <Kicker>The workspace</Kicker>
          <h2 id="pro-tour-title" className="pro-h2">From the first cut to the signed-off master.</h2>
        </div>
        <div className="pro-tour-grid" ref={track}>
          <div className="pro-tour-copy">
            {CHAPTERS.map((chapter, i) => (
              <article key={chapter.key} className={cn("pro-chapter", i === active && "is-active")}>
                <p className="pro-chapter-label"><span>{String(i + 1).padStart(2, "0")}</span>{chapter.label}</p>
                <h3>{chapter.title}</h3>
                <p>{chapter.body}</p>
                <ul>{chapter.points.map((point) => <li key={point}><Check aria-hidden="true" />{point}</li>)}</ul>
                <div className="pro-chapter-shot"><Shot name={chapter.key} sizes="(max-width: 960px) 100vw, 820px" /></div>
              </article>
            ))}
          </div>
          <div className="pro-tour-stage" aria-hidden="true">
            <div className="pro-tour-sticky">
              <div className="pro-tour-frame">
                {CHAPTERS.map((chapter, i) => (
                  <div key={chapter.key} className={cn("pro-tour-screen", i === active && "is-active", i < active && "is-past")}>
                    <Shot name={chapter.key} sizes="(max-width: 960px) 100vw, 820px" />
                  </div>
                ))}
              </div>
              <ol className="pro-tour-index">
                {CHAPTERS.map((chapter, i) => <li key={chapter.key} className={cn(i === active && "is-active")}>{String(i + 1).padStart(2, "0")} {chapter.label}</li>)}
              </ol>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------- AI QA close-up ---------- */

const FINDINGS = [
  { found: "PREMUIM", fix: "PREMIUM", kind: "Typo vs approved copy" },
  { found: "Recieve", fix: "Receive", kind: "Typo vs approved copy" },
  { found: "50%", fix: "40%", kind: "Price differs from approved" },
  { found: "—", fix: "bag", kind: "Approved line missing" },
];

export function ProQa() {
  const ref = useRef<HTMLDivElement>(null);
  const lite = useLiteMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "center 55%"] });
  const p = useSpring(scrollYProgress, { stiffness: 140, damping: 32, mass: 0.35 });
  const rotateY = useTransform(p, [0, 1], [-14, 0]);
  const scale = useTransform(p, [0, 1], [0.94, 1]);

  return (
    <section className="pro-qa" aria-labelledby="pro-qa-title">
      <div className="pro-wrap pro-qa-grid">
        <div className="pro-qa-copy">
          <Kicker>AI Visual QA</Kicker>
          <h2 id="pro-qa-title" className="pro-h2">Catch the typo before the client does.</h2>
          <p className="pro-body">
            Pick the approved copy and {name} reads every word on the poster: misspellings, a price that changed between drafts, a line that never made it in.
            One click turns the high-confidence findings into comments.
          </p>
          <table className="pro-findings">
            <caption className="pro-sr">Findings on the Summer sale poster</caption>
            <thead><tr><th scope="col">On the artwork</th><th scope="col">Approved</th><th scope="col">Finding</th></tr></thead>
            <tbody>
              {FINDINGS.map((row) => (
                <tr key={row.kind + row.fix}><td><s>{row.found}</s></td><td>{row.fix}</td><td>{row.kind}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="pro-qa-media" ref={ref}>
          <motion.div className="pro-window is-tilt" style={lite ? undefined : { rotateY, scale }}>
            <Shot name="aiqaPoster" sizes="(max-width: 960px) 100vw, 760px" />
          </motion.div>
        </div>
      </div>
    </section>
  );
}

/* ---------- workflow ---------- */

const FLOW = [
  { tc: "00:00", title: "Upload", body: "Drop masters, proxies and stills up to 1 GB each. They file themselves by client and project." },
  { tc: "00:01", title: "Review", body: "Send a link. Clients watch, draw and comment on the frame, without creating an account." },
  { tc: "00:02", title: "Approve", body: "Approve or request changes on the exact version, with a record of who decided and when." },
  { tc: "00:03", title: "Deliver", body: "Approved versions wait in the client’s portal, ready to download. Invoices sit beside them." },
];

export function ProFlow() {
  const ref = useRef<HTMLOListElement>(null);
  const lite = useLiteMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 85%", "end 45%"] });
  const p = useSpring(scrollYProgress, { stiffness: 120, damping: 30 });

  return (
    <section className="pro-flow" aria-labelledby="pro-flow-title">
      <div className="pro-wrap">
        <div className="pro-section-head">
          <Kicker>How a job moves</Kicker>
          <h2 id="pro-flow-title" className="pro-h2">Four steps. One record of all of them.</h2>
        </div>
        <ol className="pro-flow-list" ref={ref}>
          <motion.span className="pro-flow-line" aria-hidden="true" style={lite ? { scaleX: 1 } : { scaleX: p }} />
          {FLOW.map((step, i) => (
            <Reveal as="li" key={step.title} delay={i * 0.08}>
              <span className="pro-flow-tc">{step.tc}</span>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
            </Reveal>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* ---------- pricing teaser ---------- */

export function ProPricing() {
  return (
    <section className="pro-pricing" aria-labelledby="pro-pricing-title">
      <div className="pro-wrap pro-pricing-grid">
        <div>
          <Kicker>Pricing</Kicker>
          <h2 id="pro-pricing-title" className="pro-h2">One plan, priced for working studios.</h2>
          <p className="pro-body">Everything in {name}, for {symbol}{proMonthly} a month. Start with a {trialDays}-day free trial and run a real client job through it before you decide.</p>
          <Link className="pro-link is-arrow" href="/pricing">Full pricing and plan details <ArrowRight aria-hidden="true" /></Link>
        </div>
        <Reveal className="pro-price">
          <div className="pro-price-head">
            <h3>Pro</h3>
            <span className="pro-price-trial">{trialDays}-day free trial</span>
          </div>
          <p className="pro-price-amount"><strong>{symbol}{proMonthly}</strong><span>per month, billed in {currency}</span></p>
          <ul>{PRO_FEATURES.map((feature) => <li key={feature}><Check aria-hidden="true" />{feature}</li>)}</ul>
          <Link className="pro-btn is-block" href={siteConfig.links.signUp}>Start free trial</Link>
        </Reveal>
      </div>
    </section>
  );
}

/* ---------- FAQ ---------- */

export function ProFaq({ items }: { items: FaqItem[] }) {
  return (
    <section className="pro-faq" aria-labelledby="pro-faq-title">
      <div className="pro-wrap pro-faq-grid">
        <div>
          <Kicker>Questions</Kicker>
          <h2 id="pro-faq-title" className="pro-h2">What studios ask first.</h2>
        </div>
        <div className="pro-faq-list">
          {items.map((item) => (
            <details key={item.q}>
              <summary>{item.q}</summary>
              <div>{item.a}</div>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------- closing ---------- */

export function ProClosing() {
  return (
    <section className="pro-closing" aria-labelledby="pro-closing-title">
      <div className="pro-wrap">
        <Ruler marks={[18, 34, 52, 71]} />
        <Reveal>
          <h2 id="pro-closing-title" className="pro-h2 is-xl">Send the next cut through {name}.</h2>
          <p className="pro-lede">Bring one live job. See how much quieter the inbox gets by the second round of notes.</p>
          <Ctas secondary={{ href: siteConfig.links.signIn, label: "Log in" }} />
        </Reveal>
      </div>
    </section>
  );
}
