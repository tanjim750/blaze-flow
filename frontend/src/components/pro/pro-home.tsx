"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode, type PointerEvent } from "react";
import Image from "next/image";
import Link from "next/link";
import { animate, motion, useInView, useMotionValue, useScroll, useSpring, useTransform } from "motion/react";
import { ArrowRight, Check } from "@/components/icons";
import { DemoVideo } from "@/components/marketing/demo-video";
import { useFinePointer, useReducedMotionSafe } from "@/components/marketing/motion-prefs";
import { SCREENS, type ScreenKey } from "@/components/marketing/screenshot";
import { siteConfig } from "@/lib/site-config";
import { cn } from "@/lib/utils";
import { ProHeroBg } from "./pro-hero-bg";

export type FaqItem = { q: string; a: ReactNode };

const { name } = siteConfig;
const { symbol, currency, trialDays } = siteConfig.pricing;
export const EASE = [0.22, 1, 0.36, 1] as const;

/*
 * Motion budget for this page. Full scroll-linked motion everywhere except phones (<700px),
 * Data Saver and reduced motion. Unlike the shared useLiteMotion it does not guess from CPU
 * count, so an ordinary laptop always gets the full effects.
 */
const smallQuery = "(max-width: 699px)";
const subscribeSmall = (cb: () => void) => {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mq = window.matchMedia(smallQuery);
  mq.addEventListener?.("change", cb);
  return () => mq.removeEventListener?.("change", cb);
};
const getSmall = () => typeof window !== "undefined" && !!window.matchMedia?.(smallQuery)?.matches;
const getSaveData = () => typeof navigator !== "undefined" && !!(navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;
const noop = () => () => {};
export function useLiteMotion(): boolean {
  const reduce = useReducedMotionSafe();
  const small = useSyncExternalStore(subscribeSmall, getSmall, () => false);
  const save = useSyncExternalStore(noop, getSaveData, () => false);
  return reduce || small || save;
}

/* ---------- real captures from the demo workspace (public/marketing/v3, 2× density) ---------- */

export const V3 = {
  portalProject: { src: "/marketing/v3/portal-project.webp", w: 2400, h: 1500, alt: "Client portal project page: progress from kick-off to delivered, approved deliverables to download and the sign-off record" },
  posterArt: { src: "/marketing/v3/poster-art.webp", w: 1153, h: 1440, alt: "Summer sale poster with the misspelt word PREMUIM" },
  finding1: { src: "/marketing/v3/finding-1.webp", w: 706, h: 259, alt: "Finding: PREMUIM should be PREMIUM, high confidence" },
  finding2: { src: "/marketing/v3/finding-2.webp", w: 706, h: 258, alt: "Finding: Recieve should be Receive, high confidence" },
  finding3: { src: "/marketing/v3/finding-3.webp", w: 706, h: 262, alt: "Finding: 50% differs from the approved 40%" },
  finding4: { src: "/marketing/v3/finding-4.webp", w: 706, h: 258, alt: "Finding: the word bag is in the approved copy but missing from the poster" },
  payouts: { src: "/marketing/v3/money-payouts.webp", w: 1058, h: 900, alt: "Payouts by editor: earned, paid and owed for each editor" },
  invoiceTotals: { src: "/marketing/v3/invoice-totals.webp", w: 1623, h: 410, alt: "Invoice INV-0002: total £3,250, paid £1,300, balance due £1,950" },
  stepper: { src: "/marketing/v3/portal-stepper.webp", w: 2256, h: 180, alt: "Project progress: kick-off, in production, your review, signed off, delivered" },
  signoff: { src: "/marketing/v3/portal-signoff.webp", w: 1274, h: 475, alt: "Sign-off record: V4 approved by Rachel Kim, V2 changes asked" },
} as const;
type Asset = { src: string; w: number; h: number; alt: string };

export function Pic({ img, sizes, className, decorative = false }: { img: Asset; sizes: string; className?: string; decorative?: boolean }) {
  return <Image className={className} src={img.src} alt={decorative ? "" : img.alt} width={img.w} height={img.h} sizes={sizes} loading="lazy" />;
}

export function Shot({ name: key, sizes, decorative = false }: { name: ScreenKey; sizes: string; decorative?: boolean }) {
  const s = SCREENS[key];
  return <Image src={s.src} alt={decorative ? "" : s.alt} width={2880} height={1800} sizes={sizes} loading="lazy" />;
}

/** One fade-and-rise when something first scrolls into view. */
export function Reveal({ children, className, delay = 0, y = 64, tilt = 0, ...rest }: { children: ReactNode; className?: string; delay?: number; y?: number; tilt?: number; [data: `data-${string}`]: string | undefined }) {
  const reduce = useReducedMotionSafe();
  return (
    <motion.div
      {...rest}
      className={className}
      initial={reduce ? false : { opacity: 0, y, rotateX: tilt, scale: tilt ? 0.96 : 1 }}
      whileInView={{ opacity: 1, y: 0, rotateX: 0, scale: 1 }}
      viewport={{ once: true, margin: "0px 0px -8% 0px" }}
      transition={{ duration: 1, ease: EASE, delay }}
      style={tilt ? { transformPerspective: 1200 } : undefined}
    >
      {children}
    </motion.div>
  );
}

/** Steps 0..n once the element is in view; reduced motion jumps straight to the end. */
function useSequence(steps: number, interval = 650) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.35 });
  const reduce = useReducedMotionSafe();
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (!inView || reduce) return;
    let i = 0;
    const id = window.setInterval(() => { i += 1; setStep(i); if (i >= steps) window.clearInterval(id); }, interval);
    return () => window.clearInterval(id);
  }, [inView, reduce, steps, interval]);
  return { ref, step: reduce ? steps : step, inView: inView || reduce };
}

/** A scroll-linked tilt that settles flat as the element reaches the middle of the screen. */
export function useSettle(from: number, axis: "x" | "y" = "y") {
  const ref = useRef<HTMLDivElement>(null);
  const lite = useLiteMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "center 55%"] });
  const p = useSpring(scrollYProgress, { stiffness: 90, damping: 24, mass: 0.5 });
  const rot = useTransform(p, [0, 1], [from, 0]);
  const tip = useTransform(p, [0, 1], [14, 0]);
  const scale = useTransform(p, [0, 1], [0.86, 1]);
  const y = useTransform(p, [0, 1], [80, 0]);
  return { ref, style: lite ? undefined : axis === "y" ? { rotateY: rot, rotateX: tip, scale, y } : { rotateX: rot, scale, y } };
}

export function TrialButton({ children = "Start free trial", light = false }: { children?: ReactNode; light?: boolean }) {
  return <Link className={cn("pro-btn", light && "is-light")} href={siteConfig.links.signUp}>{children}<ArrowRight aria-hidden="true" /></Link>;
}

/* ---------- hero ---------- */

export function ProHero() {
  const stage = useRef<HTMLDivElement>(null);
  const lite = useLiteMotion();
  const fine = useFinePointer();
  const reduce = useReducedMotionSafe();
  const { scrollYProgress } = useScroll({ target: stage, offset: ["start end", "start 10%"] });
  const p = useSpring(scrollYProgress, { stiffness: 130, damping: 30, mass: 0.4 });
  const mx = useSpring(useMotionValue(0), { stiffness: 80, damping: 20 });
  const my = useSpring(useMotionValue(0), { stiffness: 80, damping: 20 });
  const tiltX = useTransform(p, [0, 1], [34, 0]);
  const rotateX = useTransform([tiltX, my], ([a, b]: number[]) => a + b);
  const rotateY = useTransform(mx, (v) => v);
  const scale = useTransform(p, [0, 1], [0.84, 1]);
  const near = useTransform(p, [0, 1], [200, -60]);
  const mid = useTransform(p, [0, 1], [120, -20]);
  const far = useTransform(p, [0, 1], [280, -90]);
  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (lite || !fine) return;
    const r = event.currentTarget.getBoundingClientRect();
    mx.set(((event.clientX - r.left) / r.width - 0.5) * 10);
    my.set(-((event.clientY - r.top) / r.height - 0.5) * 7);
  };
  const reset = () => { mx.set(0); my.set(0); };
  const enter = (delay: number) => (reduce ? {} : { initial: { opacity: 0, y: 48 }, animate: { opacity: 1, y: 0 }, transition: { duration: 1.1, ease: EASE, delay } });
  const fly = (delay: number, x: number, y = 0) => (reduce ? {} : { initial: { opacity: 0, x, y, scale: 0.9 }, animate: { opacity: 1, x: 0, y: 0, scale: 1 }, transition: { duration: 1.3, ease: EASE, delay } });

  return (
    <section className="pro-hero" aria-labelledby="pro-hero-title">
      <ProHeroBg />
      <div className="pro-wrap pro-hero-copy">
        {/* No entrance on the headline: it is the largest paint, so it shows at once. */}
        <h1 id="pro-hero-title" className="pro-h1">Client review for video studios</h1>
        <motion.p className="pro-sub" {...enter(0.08)}>Clients leave notes on the exact frame. Invoices and editor pay sit in the same app.</motion.p>
        <motion.div className="pro-ctas" {...enter(0.16)}>
          <TrialButton light>Start {trialDays}-day free trial</TrialButton>
          <Link className="pro-btn is-ghost" href="#features">See the features</Link>
        </motion.div>
        <motion.p className="pro-fine" {...enter(0.22)}>From {symbol}{siteConfig.plans[0].monthly} a month after the trial. Clients don&rsquo;t need an account.</motion.p>
      </div>

      <div className="pro-stage" ref={stage} onPointerMove={move} onPointerLeave={reset}>
        <motion.div className="pro-scene" style={lite ? undefined : { rotateX, rotateY, scale }} {...(reduce ? {} : { initial: { opacity: 0, y: 120 }, animate: { opacity: 1, y: 0 }, transition: { duration: 1.4, ease: EASE, delay: 0.3 } })}>
          <div className="pro-window">
            <DemoVideo label={`${name} review page: a client cut playing, with time-stamped comments and drawings beside it`} />
          </div>
          <motion.figure className="pro-layer is-qa" style={lite ? undefined : { y: near }}>
            <motion.div {...fly(0.7, -160)}><Pic img={V3.finding1} sizes="340px" /></motion.div>
          </motion.figure>
          <motion.figure className="pro-layer is-signoff" style={lite ? undefined : { y: far }}>
            <motion.div {...fly(0.9, 160)}><Pic img={V3.signoff} sizes="420px" /></motion.div>
          </motion.figure>
          <motion.figure className="pro-layer is-money" style={lite ? undefined : { y: mid }}>
            <motion.div {...fly(1.1, 0, 140)}><Pic img={V3.invoiceTotals} sizes="440px" /></motion.div>
          </motion.figure>
        </motion.div>
      </div>
    </section>
  );
}

/* ---------- three featured scenes ---------- */

function SceneCopy({ id, label, title, line, points }: { id: string; label: string; title: string; line: string; points: string[] }) {
  return (
    <Reveal className="pro-scene-copy">
      <p className="pro-label">{label}</p>
      <h2 id={id} className="pro-h2">{title}</h2>
      <p className="pro-line">{line}</p>
      <ul className="pro-points">{points.map((p) => <li key={p}><Check aria-hidden="true" />{p}</li>)}</ul>
    </Reveal>
  );
}

export const BOXES = [
  { left: 4.9, top: 35, width: 35, height: 11.7 },
  { left: 6.4, top: 51.8, width: 18.2, height: 5.6 },
  { left: 62, top: 59.4, width: 8.8, height: 5.2 },
];
const FINDINGS = [V3.finding1, V3.finding2, V3.finding3, V3.finding4];

export function ProQaScene() {
  const { ref, step, inView } = useSequence(5, 1000);
  const { ref: settleRef, style: settleStyle } = useSettle(-26);
  const reduce = useReducedMotionSafe();
  return (
    <section id="features" className="pro-feature is-qa" aria-labelledby="pro-qa-title">
      <div className="pro-wrap pro-feature-grid">
        <SceneCopy
          id="pro-qa-title"
          label="AI Visual QA"
          title="Spelling mistakes found before the client sees them"
          line="It reads the text on posters and video frames and checks it against the approved copy."
          points={["Typos, changed prices and missing words", "Boxed on the image, timed on video"]}
        />
        <div className="pro-qa-visual" ref={ref}>
          <div className="pro-persp" ref={settleRef}>
            <motion.div className="pro-poster" style={settleStyle}>
              <Pic img={V3.posterArt} sizes="(max-width: 960px) 70vw, 420px" />
              {inView && !reduce && step < 4 && <span className="pro-scan" aria-hidden="true" />}
              {BOXES.map((b, i) => (
                <motion.span
                  key={i}
                  className="pro-typo-box"
                  aria-hidden="true"
                  style={{ left: `${b.left}%`, top: `${b.top}%`, width: `${b.width}%`, height: `${b.height}%` }}
                  initial={false}
                  animate={step > i ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 1.6 }}
                  transition={{ type: "spring", stiffness: 260, damping: 18 }}
                />
              ))}
            </motion.div>
          </div>
          <ol className="pro-findings" aria-label="Findings">
            {FINDINGS.map((img, i) => (
              <motion.li
                key={img.src}
                initial={false}
                animate={step > i ? { opacity: 1, x: 0, rotateY: 0 } : { opacity: 0, x: 120, rotateY: -25 }}
                transition={{ duration: 0.8, ease: EASE }}
                style={{ transformPerspective: 900 }}
              >
                <Pic img={img} sizes="(max-width: 960px) 80vw, 340px" />
              </motion.li>
            ))}
          </ol>
          <motion.p className="pro-count" initial={false} animate={{ opacity: step >= 4 ? 1 : 0 }} aria-hidden={step < 4}>
            4 findings on V1 · 3 high confidence
          </motion.p>
        </div>
      </div>
    </section>
  );
}

export function ProPortalScene() {
  const { ref, step } = useSequence(3, 900);
  const { ref: settleRef, style: settleStyle } = useSettle(26);
  return (
    <section className="pro-feature is-portal" aria-labelledby="pro-portal-title">
      <div className="pro-wrap pro-feature-grid is-flip">
        <SceneCopy
          id="pro-portal-title"
          label="Client portal"
          title="Your clients approve cuts in a portal with your logo"
          line="Every approval and change request is kept, with a name and a date."
          points={["Approved files ready to download", "No client logins for single review links"]}
        />
        <div className="pro-portal-visual" ref={ref}>
          <div className="pro-persp" ref={settleRef}>
            <motion.div className="pro-window is-shot" style={settleStyle}>
              <Pic img={V3.portalProject} sizes="(max-width: 960px) 100vw, 760px" />
            </motion.div>
          </div>
          <motion.figure
            className="pro-float is-stepper"
            initial={false}
            animate={{ clipPath: step >= 1 ? "inset(0 0% 0 0 round 10px)" : "inset(0 100% 0 0 round 10px)" }}
            transition={{ duration: 1.6, ease: EASE }}
          >
            <Pic img={V3.stepper} sizes="(max-width: 960px) 90vw, 640px" />
          </motion.figure>
          <div className="pro-portal-progress" aria-hidden="true">
            <motion.span initial={false} animate={{ scaleX: step >= 1 ? 1 : 0 }} transition={{ duration: 2.2, ease: EASE, delay: 0.3 }} />
          </div>
          <motion.figure
            className="pro-float is-signoff"
            initial={false}
            animate={step >= 2 ? { opacity: 1, y: 0, x: 0, scale: 1 } : { opacity: 0, y: 90, x: 60, scale: 0.9 }}
            transition={{ duration: 1, ease: EASE }}
          >
            <Pic img={V3.signoff} sizes="(max-width: 960px) 90vw, 440px" />
          </motion.figure>
        </div>
      </div>
    </section>
  );
}

/** A figure that counts up from zero the first time it scrolls into view. */
export function Count({ value, prefix = "", className }: { value: number; prefix?: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.4 });
  const reduce = useReducedMotionSafe();
  const fmt = (n: number) => prefix + Math.round(n).toLocaleString("en-GB");
  useEffect(() => {
    const el = ref.current;
    if (!el || !inView || reduce) return;
    const controls = animate(0, value, { duration: 2.4, ease: EASE, onUpdate: (v) => { el.textContent = fmt(v); } });
    return () => controls.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inView, reduce, value]);
  return <span ref={ref} className={className}>{fmt(value)}</span>;
}

export const SUMS = [
  { label: "Clients owe you", value: 8330, note: "2 invoices overdue" },
  { label: "You owe editors", value: 760, note: "Earned on approved tasks" },
  { label: "Margin", value: 19180, note: "86.9% of priced work" },
  { label: "Collected", value: 8150, note: "Of £16,480 billed" },
];

export function ProMoneyScene() {
  const { ref: settleRef, style: settleStyle } = useSettle(-24);
  return (
    <section className="pro-feature is-money" aria-labelledby="pro-money-title">
      <div className="pro-wrap pro-feature-grid">
        <SceneCopy
          id="pro-money-title"
          label="Money"
          title="What clients owe you, and what you owe your editors"
          line="Invoices come from the project fee and priced tasks. An editor’s pay is earned when their task is approved."
          points={["Part payments and overdue invoices", "Each editor’s earned, paid and owed"]}
        />
        <div className="pro-money-visual">
          <dl className="pro-sums">
            {SUMS.map((s, i) => (
              <Reveal key={s.label} delay={i * 0.12} y={50} tilt={20} className="pro-sum">
                <dt>{s.label}</dt>
                <dd><Count value={s.value} prefix="£" /></dd> {/* the demo studio bills in GBP, as in the screenshots */}
                <dd className="pro-sum-note">{s.note}</dd>
              </Reveal>
            ))}
          </dl>
          <div className="pro-money-stack">
            <div className="pro-persp" ref={settleRef}>
              <motion.div className="pro-window is-shot is-payouts" style={settleStyle}>
                <Pic img={V3.payouts} sizes="(max-width: 960px) 90vw, 440px" />
              </motion.div>
            </div>
            <Reveal className="pro-float is-invoice" delay={0.2}>
              <Pic img={V3.invoiceTotals} sizes="(max-width: 960px) 90vw, 460px" />
            </Reveal>
          </div>
          <p className="pro-source">Figures from the demo studio&rsquo;s Money page.</p>
        </div>
      </div>
    </section>
  );
}

/* ---------- bento: the rest of the app ---------- */

/** `focus` frames the interesting part of each screenshot: rendered width and offset, in px. */
const TILES: { key: ScreenKey; title: string; line: string; size?: "wide"; focus: [number, number, number] }[] = [
  { key: "review", title: "Notes on the frame", line: "Comments, drawings and voice notes at a timecode.", size: "wide", focus: [1300, -330, -200] },
  { key: "aiqaVideo", title: "QA on video too", line: "Each finding has its time range.", focus: [980, -250, -150] },
  { key: "files", title: "1 GB uploads", line: "Masters upload in the background.", focus: [980, -330, -60] },
  { key: "tasks", title: "Notes become tasks", line: "With the version and timecode attached.", size: "wide", focus: [1300, -240, -40] },
];

export function ProBento() {
  return (
    <section className="pro-bento" aria-labelledby="pro-bento-title">
      <div className="pro-wrap">
        <Reveal><h2 id="pro-bento-title" className="pro-h2 is-center">Also in {name}</h2></Reveal>
        <div className="pro-bento-grid">
          {TILES.map((t, i) => (
            <Reveal key={t.key} delay={(i % 2) * 0.14} tilt={18} className={cn("pro-tile", t.size === "wide" && "is-wide")}>
              <div className="pro-tile-copy">
                <h3>{t.title}</h3>
                <p>{t.line}</p>
              </div>
              <div className="pro-tile-shot" style={{ "--w": `${t.focus[0]}px`, "--x": `${t.focus[1]}px`, "--y": `${t.focus[2]}px` } as CSSProperties}><Shot name={t.key} sizes="1300px" /></div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------- pricing, FAQ, closing ---------- */

export function ProPricing() {
  return (
    <section className="pro-pricing" aria-labelledby="pro-pricing-title">
      <div className="pro-wrap">
        <Reveal className="pro-pricing-head">
          <h2 id="pro-pricing-title" className="pro-h2">Three plans</h2>
          <p className="pro-line">Every plan starts with a {trialDays}-day free trial. Prices in {currency}.</p>
        </Reveal>
        <ProPlans headingLevel="h3" />
        <p className="pro-fine is-center"><Link className="pro-link" href="/pricing">Compare plans <ArrowRight aria-hidden="true" /></Link></p>
      </div>
    </section>
  );
}

/** The three plan cards, rendered from `siteConfig.plans`. */
export function ProPlans({ headingLevel = "h3" }: { headingLevel?: "h2" | "h3" }) {
  const H = headingLevel;
  return (
    <div className="pro-plans">
      {siteConfig.plans.map((plan, i) => (
        <Reveal key={plan.id} delay={i * 0.12} tilt={16} className={cn("pro-plan", plan.highlighted && "is-featured")} data-plan={plan.id} data-to-confirm={plan.toConfirm ? "true" : undefined}>
          <article>
            <div className="pro-plan-top">
              <H className="pro-plan-name">{plan.name}{plan.highlighted && <span className="pro-plan-pick">Most popular</span>}</H>
              {plan.toConfirm && <span className="pro-badge">To confirm</span>}
            </div>
            <p className="pro-plan-price"><strong>{symbol}{plan.monthly}</strong> a month</p>
            <Link className={cn("pro-btn", !plan.highlighted && "is-ghost")} href={siteConfig.links.signUp}>Start {trialDays}-day free trial</Link>
            <ul className="pro-points">
              {plan.features.map((f) => <li key={f}><Check aria-hidden="true" />{f}</li>)}
            </ul>
          </article>
        </Reveal>
      ))}
    </div>
  );
}

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

export function ProClosing() {
  return (
    <section className="pro-closing" aria-labelledby="pro-closing-title">
      <div className="pro-wrap">
        <Reveal>
          <h2 id="pro-closing-title" className="pro-h2 is-center is-xl">Try it on your next client job</h2>
          <div className="pro-ctas is-center">
            <TrialButton light>Start {trialDays}-day free trial</TrialButton>
            <Link className="pro-btn is-ghost" href={siteConfig.links.signIn}>Log in</Link>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
