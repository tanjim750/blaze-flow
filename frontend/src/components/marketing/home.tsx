"use client";

import Link from "next/link";
import Image from "next/image";
import { useRef, type ReactNode } from "react";
import { ArrowRight, Asterisk, Check, Paperclip, UploadCloud } from "lucide-react";
import { motion, useScroll, useSpring, useTransform } from "motion/react";
import { siteConfig } from "@/lib/site-config";
import { cn } from "@/lib/utils";
import { DemoVideo } from "./demo-video";
import { useLiteMotion, useReducedMotionSafe } from "./motion-prefs";
import { Rise, Scribble, Sticker, Tilt, springy } from "./playful";
import { STROKES } from "./strokes";
import { SCREENS, Screenshot, type ScreenKey } from "./screenshot";
import type { Tone } from "./sections";

/*
 * The homepage, in the "playful" direction: cream paper, poster colours, hand-drawn
 * scribbles (the product is literally drawing on frames), stickers, clay-style shapes and
 * screenshot cards that tilt in 3D.
 *
 * Motion budget: continuous scroll-linked effects (clay parallax, the showcase's 3D swing,
 * the scroll-driven upload bar) only run on larger screens with decent hardware; small,
 * data-saver and low-power devices get one-shot entrances; reduced motion gets none.
 */

const { name } = siteConfig;
const { symbol, proMonthly, trialDays } = siteConfig.pricing;

export function HomeHero() {
  const lite = useLiteMotion();
  const { scrollY } = useScroll();
  const drift = useTransform(scrollY, [0, 600], [0, -80]);
  const driftFast = useTransform(scrollY, [0, 600], [0, -140]);
  const spin = useTransform(scrollY, [0, 600], [0, 120]);
  return (
    <section className="mk-hero" aria-labelledby="mk-hero-title">
      <div className="mk-hero-copy">
        <p className="mk-eyebrow">Review and approvals for video people</p>
        <h1 id="mk-hero-title">
          <span className="mk-hero-line">Circle it.<Scribble className="mk-s-circle" viewBox={STROKES.circle.viewBox} d={STROKES.circle.d} width={4} delay={0.4} /></span>{" "}
          <span className="mk-hero-line is-tomato">Scribble it.<Scribble className="mk-s-wave" viewBox={STROKES.wave.viewBox} d={STROKES.wave.d} width={5} delay={0.9} /></span>{" "}
          <span className="mk-hero-line">Ship it.<Scribble className="mk-s-arrow" viewBox={STROKES.arrow.viewBox} d={STROKES.arrow.d} width={5} delay={1.3} /></span>
        </h1>
        <p className="mk-hero-lede">
          {name} is review and delivery for video agencies. Your client draws on the frame, you get the
          timecode, and nobody types “around the 40-second mark” ever again.
        </p>
        <div className="mk-ctas">
          <Link className="mk-btn" href={siteConfig.links.signUp}>Start your {trialDays}-day free trial <ArrowRight aria-hidden="true" /></Link>
          <Link className="mk-btn is-ghost" href={siteConfig.links.signIn}>Log in</Link>
        </div>
        <p className="mk-fineprint">{trialDays} days free, then {symbol}{proMonthly} a month, billed in GBP. No sales call.</p>
      </div>
      <div className="mk-hero-art">
        <motion.span className="mk-clay mk-clay-ball" aria-hidden="true" style={lite ? undefined : { y: driftFast }} />
        <motion.span className="mk-clay mk-clay-ring" aria-hidden="true" style={lite ? undefined : { y: drift, rotate: spin }} />
        <motion.span className="mk-clay mk-clay-pill" aria-hidden="true" style={lite ? undefined : { y: driftFast, rotate: spin }} />
        <Tilt className="mk-pile" max={14}>
          <Image className="mk-pile-card is-back" src={SCREENS.tasks.src} alt="" width={1920} height={1200} sizes="(max-width: 900px) 80vw, 560px" />
          <Image className="mk-pile-card is-mid" src={SCREENS.aiqaPoster.src} alt="" width={1920} height={1200} sizes="(max-width: 900px) 80vw, 560px" />
          <Image className="mk-pile-card is-front" src={SCREENS.review.src} alt={SCREENS.review.alt} width={1920} height={1200} sizes="(max-width: 900px) 86vw, 600px" preload fetchPriority="high" />
        </Tilt>
        <Sticker className="mk-sticker-ok" delay={0.5}><Check aria-hidden="true" />V3 approved!</Sticker>
        <Sticker className="mk-sticker-round" delay={0.62}>{trialDays} days<br />free</Sticker>
        <Sticker className="mk-sticker-tc" delay={0.74}>00:02 · “hold on the cup”</Sticker>
      </div>
    </section>
  );
}

const AUDIENCE = ["video production agencies", "post-production studios", "motion teams", "social content studios", "freelance editors", "anyone who has exported final_v7_REAL.mov"];

/** "Built for" as a tilted ink ribbon. Plain CSS animation; stops for reduced motion. */
export function Marquee() {
  const row = <span>{AUDIENCE.map((item) => <b key={item}>{item}<Asterisk aria-hidden="true" /></b>)}</span>;
  return (
    <section className="mk-marquee" aria-label="Who it is for">
      <h2 className="mk-sr">Built for video agencies, studios and freelancers</h2>
      <ul className="mk-sr">{AUDIENCE.slice(0, 5).map((item) => <li key={item}>{item}</li>)}</ul>
      <div className="mk-marquee-track" aria-hidden="true">{row}{row}</div>
    </section>
  );
}

export function Showcase() {
  const lite = useLiteMotion();
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "center center"] });
  const progress = useSpring(scrollYProgress, { stiffness: 120, damping: 22 });
  const rotateX = useTransform(progress, [0, 1], [28, 0]);
  const rotate = useTransform(progress, [0, 1], [-5, -1.2]);
  const scale = useTransform(progress, [0, 1], [0.86, 1]);
  return (
    <section ref={ref} className="mk-show" aria-labelledby="mk-show-title">
      <div className="mk-wrap">
        <h2 id="mk-show-title">Here’s the actual app. <span>Real screens, real clicks.</span></h2>
        <div className="mk-tv-wrap">
          <p className="mk-hand mk-tv-note" aria-hidden="true">27 seconds, no actors<Scribble className="mk-s-tv" viewBox={STROKES.arrowDown.viewBox} d={STROKES.arrowDown.d} width={4} /></p>
          <motion.div className="mk-tv" style={lite ? { rotate: -1.2 } : { rotateX, rotate, scale }}>
            <DemoVideo label={`${name} product tour: dashboard, files, a video review with drawings, AI Visual QA on a poster and a video, and the tasks board`} />
          </motion.div>
        </div>
      </div>
    </section>
  );
}

function MomentCopy({ n, title, id, children, link }: { n: string; title: string; id: string; children: ReactNode; link?: { href: string; label: string } }) {
  return (
    <Rise className="mk-moment-copy">
      <span className="mk-num" aria-hidden="true">{n}</span>
      <h3 id={id}>{title}</h3>
      <p>{children}</p>
      {link && <Link className="mk-link" href={link.href}>{link.label} <ArrowRight aria-hidden="true" /></Link>}
    </Rise>
  );
}

function Moment({ n, tone, title, caption, screen, children, flip, link }: { n: string; tone: Tone; title: string; caption: ReactNode; screen: ScreenKey; children: ReactNode; flip?: boolean; link?: { href: string; label: string } }) {
  return (
    <article className={cn("mk-moment", `is-${tone}`, flip && "is-flipped")} aria-labelledby={`mk-m-${n}`}>
      <MomentCopy n={n} id={`mk-m-${n}`} title={title} link={link}>{children}</MomentCopy>
      <Rise className="mk-moment-art" delay={0.08} rotate={flip ? 2 : -2}>
        <Tilt><Screenshot name={screen} caption={caption} /></Tilt>
      </Rise>
    </article>
  );
}

function AiQaMoment() {
  const reduce = useReducedMotionSafe();
  return (
    <article className="mk-moment is-tomato is-flipped mk-qa" aria-labelledby="mk-m-2">
      <MomentCopy n="2" id="mk-m-2" title="A proofreader that never gets bored." link={{ href: "/features#ai-qa", label: "How AI Visual QA works" }}>
        AI Visual QA reads the words on your poster or in your titles, checks the spelling and the copy the
        client signed off, and flags the slips right on the frame. It only suggests: a person accepts every fix.
      </MomentCopy>
      <div className="mk-moment-art">
        <div className="mk-typo">
          <span className="mk-typo-word" aria-hidden="true">
            PREMUIM
            <svg className="mk-typo-strike" viewBox="0 0 400 60" aria-hidden="true" focusable="false">
              <motion.path d="M6 38 C90 22 200 44 394 18" stroke="currentColor" strokeWidth="9" strokeLinecap="round" fill="none" initial={reduce ? false : { pathLength: 0 }} whileInView={{ pathLength: 1 }} viewport={{ once: true }} transition={{ duration: 0.5, delay: 0.3 }} />
            </svg>
          </span>
          <motion.span className="mk-typo-fix mk-hand" aria-hidden="true" initial={reduce ? false : { opacity: 0, scale: 0.6, rotate: -14 }} whileInView={{ opacity: 1, scale: 1, rotate: -6 }} viewport={{ once: true }} transition={{ ...springy, delay: 0.8 }}>PREMIUM!</motion.span>
          <Tilt className="mk-typo-shot"><Screenshot name="aiqaPoster" variant="card" /></Tilt>
        </div>
      </div>
    </article>
  );
}

function UploadBar() {
  const lite = useLiteMotion();
  const reduce = useReducedMotionSafe();
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 85%", "center 45%"] });
  const progress = useSpring(scrollYProgress, { stiffness: 70, damping: 18 });
  const width = useTransform(progress, [0, 1], ["4%", "100%"]);
  const left = useTransform(progress, [0, 1], ["2%", "98%"]);
  const label = useTransform(progress, (v) => `${Math.round(Math.min(1, Math.max(0, v)) * 1000)} MB`);
  const done = reduce;
  return (
    <div ref={ref} className="mk-upload" aria-hidden="true">
      <p><UploadCloud /> master_v7_FINAL_actually.mov {lite ? <b>1000 MB</b> : <motion.b>{label}</motion.b>}</p>
      <div className="mk-upload-track">
        {lite
          ? <motion.i initial={done ? false : { width: "4%" }} whileInView={{ width: "100%" }} viewport={{ once: true }} transition={{ duration: 1.6, ease: "easeInOut" }} style={done ? { width: "100%" } : undefined} />
          : <motion.i style={{ width }} />}
        {lite
          ? <motion.span className="mk-clay mk-clay-roll" initial={done ? false : { left: "2%" }} whileInView={{ left: "98%" }} viewport={{ once: true }} transition={{ duration: 1.6, ease: "easeInOut" }} style={done ? { left: "98%" } : undefined} />
          : <motion.span className="mk-clay mk-clay-roll" style={{ left }} />}
      </div>
    </div>
  );
}

function FilesMoment() {
  return (
    <article className="mk-moment is-sky mk-files" aria-labelledby="mk-m-4">
      <MomentCopy n="4" id="mk-m-4" title="Big files? Throw them in.">
        Masters up to 1 GB upload in the background while you carry on cutting. Everything files itself by
        client and project, with durations and review stages, and opens straight into review.
      </MomentCopy>
      <Rise className="mk-moment-art" delay={0.08} rotate={-1.5}>
        <UploadBar />
        <Tilt><Screenshot name="files" caption={<><Paperclip aria-hidden="true" /> sorted by client, all by itself</>} /></Tilt>
      </Rise>
    </article>
  );
}

export function HomeMoments() {
  return (
    <section id="what-it-does" className="mk-moments" aria-labelledby="mk-moments-title">
      <div className="mk-wrap">
        <h2 id="mk-moments-title" className="mk-sr">What {name} does</h2>
        <Moment n="1" tone="sun" title="Draw right on the frame." caption="the actual note, on the actual frame" screen="review" link={{ href: "/features#review", label: "More on review" }}>
          Your client circles the thing. You get the circle, the timecode and their words, pinned to that exact
          moment of V2, plus versions side by side and one-click approvals. Tick it off, export V3, go home.
        </Moment>
        <AiQaMoment />
        <Moment n="3" tone="mint" title="A little home for every client." caption="your logo, not ours" screen="portal" flip>
          One place per client for cuts waiting on them, approved masters to download, invoices and a drop zone
          for their brand assets. They stop asking for the link. You stop resending it.
        </Moment>
        <FilesMoment />
        <Moment n="5" tone="pink" title="Notes turn into tasks." caption="the frame comes along too" screen="tasks" flip>
          Turn any note into a task with the frame attached, move work across stages your team defines, and see
          what is overdue or waiting on the client from the dashboard.
        </Moment>
      </div>
    </section>
  );
}

export function HomePrice() {
  const reduce = useReducedMotionSafe();
  return (
    <section id="price" className="mk-home-price" aria-labelledby="mk-price-title">
      <div className="mk-wrap">
        <div className="mk-home-price-copy">
          <h2 id="mk-price-title">One price. Everything in.</h2>
          <ul className="mk-checks is-big">
            <li><Check aria-hidden="true" />Review links your clients use without an account</li>
            <li><Check aria-hidden="true" />Drawings, voice notes, versions and approvals</li>
            <li><Check aria-hidden="true" />AI Visual QA, client portal, files and tasks</li>
          </ul>
          <div className="mk-ctas">
            <Link className="mk-btn" href={siteConfig.links.signUp}>Start your {trialDays}-day free trial <ArrowRight aria-hidden="true" /></Link>
            <Link className="mk-link" href="/pricing">Full pricing details <ArrowRight aria-hidden="true" /></Link>
          </div>
        </div>
        <motion.div className="mk-tag" initial={reduce ? false : { rotate: -26 }} whileInView={{ rotate: [-26, 13, -7, 4, -1.5, 0] }} viewport={{ once: true }} transition={{ duration: 1.8, ease: "easeOut" }}>
          <span className="mk-tag-string" aria-hidden="true" />
          <div className="mk-tag-body">
            <small>Pro</small>
            <b>{symbol}{proMonthly}</b>
            <span>a month, in GBP</span>
            <em className="mk-hand">first {trialDays} days on us</em>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
