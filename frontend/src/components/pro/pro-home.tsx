"use client";

import { useRef, useState, type ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { motion, useMotionValueEvent, useScroll, useSpring, useTransform, type MotionValue } from "motion/react";
import { ArrowRight, Check } from "lucide-react";
import { DemoVideo } from "@/components/marketing/demo-video";
import { useLiteMotion, useReducedMotionSafe } from "@/components/marketing/motion-prefs";
import { SCREENS, type ScreenKey } from "@/components/marketing/screenshot";
import type { FaqItem } from "@/components/marketing/sections";
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
      initial={reduce ? false : { opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "0px 0px -12% 0px" }}
      transition={{ duration: 0.6, ease: EASE, delay }}
    >
      {children}
    </Tag>
  );
}

/** A real screenshot at full resolution. Lazy unless `eager`. */
function Shot({ name: key, sizes = "(max-width: 960px) 100vw, 760px", className }: { name: ScreenKey; sizes?: string; className?: string }) {
  const screen = SCREENS[key];
  return <Image className={className} src={screen.src} alt={screen.alt} width={1920} height={1200} sizes={sizes} loading="lazy" />;
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

function TrialButton({ children = "Start free trial" }: { children?: ReactNode }) {
  return <Link className="pro-btn" href={siteConfig.links.signUp}>{children}</Link>;
}

/** A plain timeline ruler under the hero window, echoing the player's scrub bar. */
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
  const rotateX = useTransform(p, [0, 1], [22, 0]);
  const scale = useTransform(p, [0, 1], [0.92, 1]);
  const y = useTransform(p, [0, 1], [24, 0]);
  const floatY = useTransform(p, [0, 1], [60, -10]);
  const playhead = useTransform(p, [0, 1], ["6%", "58%"]);

  return (
    <section className="pro-hero" aria-labelledby="pro-hero-title">
      <div className="pro-wrap">
        <h1 id="pro-hero-title" className="pro-h1">Get client feedback on the frame, not in email threads.</h1>
        <div className="pro-hero-foot">
          <p className="pro-lede">
            Send your client a link to the cut. They click the moment they mean and type &ldquo;logo&rsquo;s too small here&rdquo;.
            The note lands at 0:14 on that version. You upload v3, and they approve it in the same place.
          </p>
          <div className="pro-hero-actions">
            <div className="pro-ctas">
              <TrialButton>Start a {trialDays}-day free trial</TrialButton>
              <Link className="pro-btn is-ghost" href="#tour">See the review page</Link>
            </div>
            <p className="pro-fine">Pro is {symbol}{proMonthly} a month after the trial. Your clients don&rsquo;t need an account.</p>
          </div>
        </div>
      </div>

      <div className="pro-stage-wrap" ref={stage}>
        <motion.div className="pro-stage" style={lite ? undefined : { rotateX, scale, y }}>
          <div className="pro-window">
            <div className="pro-window-bar">
              <span>Northlight Coffee / Spring Launch / Hero 30s</span>
              <span className="pro-window-tc">V2 · 00:00:14:00</span>
            </div>
            <DemoVideo label={`${name} review page: a client cut playing, with time-stamped comments and drawings beside it`} />
          </div>
          <motion.figure className="pro-float" style={lite ? undefined : { y: floatY }}>
            <Crop name="aiqaVideo" x={955} y={218} w={316} h={190} width={330} />
            <figcaption>AI Visual QA found a typo in the title at 0:01</figcaption>
          </motion.figure>
        </motion.div>
        <div className="pro-wrap"><Ruler playhead={lite ? undefined : playhead} marks={[12, 21, 27, 44, 57, 66, 81, 88]} /></div>
      </div>
    </section>
  );
}

/* ---------- facts (no customer logos yet, so no logo row) ---------- */

const SPECS = [
  { k: "Notes on the frame", v: "Comments, drawings, voice and screen recordings, pinned to a timecode or a range." },
  { k: "1 GB per file", v: "Masters and proxies upload in the background while you keep working." },
  { k: "No client logins", v: "Clients open a link to watch, comment and approve." },
  { k: `${symbol}${proMonthly} a month`, v: `One plan. Try it free for ${trialDays} days.` },
];

export function ProSpecs() {
  return (
    <section className="pro-specs" aria-label="Key facts">
      <div className="pro-wrap">
        <ul>
          {SPECS.map((spec, i) => (
            <Reveal as="li" key={spec.k} delay={i * 0.05}>
              <strong>{spec.k}</strong>
              <span>{spec.v}</span>
            </Reveal>
          ))}
        </ul>
      </div>
    </section>
  );
}

/* ---------- the problem, in one scene ---------- */

export function ProStatement() {
  return (
    <section className="pro-statement" aria-labelledby="pro-statement-title">
      <div className="pro-wrap pro-statement-grid">
        <Reveal>
          <h2 id="pro-statement-title" className="pro-h2 is-xl">Most client feedback still arrives as a screenshot in an email.</h2>
        </Reveal>
        <Reveal className="pro-statement-copy" delay={0.08}>
          <p>&ldquo;Logo&rsquo;s too small at 0:14.&rdquo; Which version? Which logo? By the third final_FINAL.mov thread, nobody is sure.</p>
          <p>In {name}, that note sits on v3 at 00:14, next to the frame it&rsquo;s about, with the client&rsquo;s name and the date on it.</p>
        </Reveal>
      </div>
    </section>
  );
}

/* ---------- the tour: sticky product screen, five chapters ---------- */

const CHAPTERS: { key: ScreenKey; label: string; title: string; body: string; points: string[] }[] = [
  {
    key: "review", label: "Review and approval", title: "Clients comment on the frame they are looking at.",
    body: "Open a cut, still or PDF in the player. The client clicks a point in the frame and types a note, or draws on it. Each note is saved with its timecode and version. When they are happy they press Approve, and you keep a record of who approved which version and when.",
    points: ["Comments, drawings, voice and screen notes", "Play v2 and v3 side by side, in sync", "Mark any comment as team-only"],
  },
  {
    key: "aiqaVideo", label: "AI Visual QA", title: "Check the text on screen against the approved copy.",
    body: "Pick the script or copy the client signed off. AI Visual QA reads the text in your poster or video frames and lists anything that doesn't match it. Each finding is boxed on the frame, with a time range on video. Nothing changes until someone on your team accepts it.",
    points: ["Spelling, changed words, prices and dates", "Lines in the approved copy that are missing", "Accept, dismiss, or turn a finding into a comment"],
  },
  {
    key: "portal", label: "Client portal", title: "Give each client a portal with your logo on it.",
    body: "Clients see what is waiting for their review, download approved files, check invoices and send you their own files. You set the logo, colour and welcome line.",
    points: ["Approved files with a sign-off record", "Clients can upload to you, up to 1 GB a file", "Messages kept per project"],
  },
  {
    key: "files", label: "Files", title: "Upload a 1 GB master and keep working.",
    body: "Uploads run in a tray at the bottom of the screen, so you can carry on while a master goes up. Files are sorted by client and project, and show duration, size and where they are in review.",
    points: ["Up to 1 GB per file", "Grid and list views, folders and filters", "Open any file straight into review"],
  },
  {
    key: "tasks", label: "Tasks", title: "Turn client notes into tasks for the edit.",
    body: "Select a client's notes and make them tasks, with the version and timecode attached. Move them across a board as the edit goes. When v4 arrives, the notes still open on v3 come with it as a checklist.",
    points: ["Assignees, due dates and priorities", "Filter by client, editor or due date", "Open notes carried to the next version"],
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
          <h2 id="pro-tour-title" className="pro-h2">What you can do in {name}</h2>
        </div>
        <div className="pro-tour-grid" ref={track}>
          <div className="pro-tour-copy">
            {CHAPTERS.map((chapter, i) => (
              <article key={chapter.key} className={cn("pro-chapter", i === active && "is-active")}>
                <p className="pro-chapter-label">{chapter.label}</p>
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
                {CHAPTERS.map((chapter, i) => <li key={chapter.key} className={cn(i === active && "is-active")}>{chapter.label}</li>)}
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
  { found: "PREMUIM", fix: "PREMIUM", kind: "Spelling, against the approved copy" },
  { found: "Recieve", fix: "Receive", kind: "Spelling, against the approved copy" },
  { found: "50%", fix: "40%", kind: "Number differs from the approved copy" },
  { found: "(missing)", fix: "bag", kind: "Word in the approved copy, not on the poster" },
];

export function ProQa() {
  const ref = useRef<HTMLDivElement>(null);
  const lite = useLiteMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "center 55%"] });
  const p = useSpring(scrollYProgress, { stiffness: 140, damping: 32, mass: 0.35 });
  const rotateY = useTransform(p, [0, 1], [-12, 0]);
  const scale = useTransform(p, [0, 1], [0.95, 1]);

  return (
    <section className="pro-qa" aria-labelledby="pro-qa-title">
      <div className="pro-wrap pro-qa-grid">
        <div className="pro-qa-copy">
          <h2 id="pro-qa-title" className="pro-h2">This poster nearly went out with PREMUIM on it.</h2>
          <p className="pro-body">
            It&rsquo;s the Summer sale poster from our demo project. We gave AI Visual QA the approved copy and it found four problems.
            Three were high confidence, so we added them to the review as comments in one click.
          </p>
          <table className="pro-findings">
            <caption className="pro-sr">AI Visual QA findings on the Summer sale poster</caption>
            <thead><tr><th scope="col">On the poster</th><th scope="col">Approved copy</th><th scope="col">Finding</th></tr></thead>
            <tbody>
              {FINDINGS.map((row) => (
                <tr key={row.kind + row.fix}><td>{row.found === "(missing)" ? <em>missing</em> : <s>{row.found}</s>}</td><td>{row.fix}</td><td>{row.kind}</td></tr>
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
  { title: "Upload", body: "Drop in the cut, poster or stills. Files up to 1 GB each go into the client's project." },
  { title: "Review", body: "Send the client a link. They watch in the browser and leave notes on the frame, without an account." },
  { title: "Approve", body: "They approve the version or ask for changes. You can see who approved v3, and when." },
  { title: "Deliver", body: "The approved file appears in the client's portal, ready to download, with the invoice next to it." },
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
          <h2 id="pro-flow-title" className="pro-h2">How a job goes through it</h2>
        </div>
        <ol className="pro-flow-list" ref={ref}>
          <motion.span className="pro-flow-line" aria-hidden="true" style={lite ? { scaleX: 1 } : { scaleX: p }} />
          {FLOW.map((step, i) => (
            <Reveal as="li" key={step.title} delay={i * 0.06}>
              <span className="pro-flow-num">{i + 1}</span>
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

const PLAN = [
  "Review links your clients can use without an account",
  "Comments, drawings, voice and screen notes on the frame",
  "Versions, side-by-side compare and approvals",
  "AI Visual QA for posters and video, against the approved copy",
  "A client portal with your logo, approved files and sign-off records",
  "Files, tasks, project chat and invoices",
  "Uploads up to 1 GB per file",
];

export function ProPricing() {
  return (
    <section className="pro-pricing" aria-labelledby="pro-pricing-title">
      <div className="pro-wrap pro-pricing-grid">
        <div>
          <h2 id="pro-pricing-title" className="pro-h2">Pricing</h2>
          <p className="pro-body">There is one plan, Pro, at {symbol}{proMonthly} a month. It includes everything on this page. Try it free for {trialDays} days on a real job before you pay.</p>
          <Link className="pro-link is-arrow" href="/pricing">See full pricing <ArrowRight aria-hidden="true" /></Link>
        </div>
        <Reveal className="pro-price">
          <div className="pro-price-head">
            <h3>Pro</h3>
            <span className="pro-price-trial">{trialDays}-day free trial</span>
          </div>
          <p className="pro-price-amount"><strong>{symbol}{proMonthly}</strong><span>a month, billed in {currency}</span></p>
          <ul>{PLAN.map((feature) => <li key={feature}><Check aria-hidden="true" />{feature}</li>)}</ul>
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
        <h2 id="pro-faq-title" className="pro-h2">Questions</h2>
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
        <Reveal>
          <h2 id="pro-closing-title" className="pro-h2 is-xl">Try it on your next client job.</h2>
          <p className="pro-lede">Start the {trialDays}-day trial, upload one cut and send the link to your client. Pro is {symbol}{proMonthly} a month after that.</p>
          <div className="pro-ctas">
            <TrialButton />
            <Link className="pro-btn is-ghost" href={siteConfig.links.signIn}>Log in</Link>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
