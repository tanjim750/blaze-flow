"use client";

import Link from "next/link";
import { useCallback, useRef, type PointerEvent, type ReactNode } from "react";
import { Asterisk, Check, Paperclip, UploadCloud } from "lucide-react";
import { motion, useMotionValue, useScroll, useSpring, useTransform } from "motion/react";
import { brand, clip, links, price, shots, trialDays, useAutoplay, useReducedMotionSafe } from "@/components/mockups/shared";

/*
 * PLAYFUL direction. Cream paper, poster colours, hand-drawn scribbles (the product is
 * literally drawing on frames), stickers, chunky clay-style 3D objects and tilting 3D
 * screenshot cards on springs. Accent: tomato. Fonts: Bricolage Grotesque + Caveat.
 */

const springy = { type: "spring", stiffness: 260, damping: 18 } as const;

export function Playful() {
  const reduce = useReducedMotionSafe();
  return (
    <div className="pl" data-reduce={reduce || undefined}>
      <header className="pl-bar">
        <Link href="/mockups/playful" className="pl-logo">{brand}</Link>
        <nav aria-label="Main">
          <a href="#moments">What it does</a>
          <a href="#price">Price</a>
          <Link href={links.signIn}>Log in</Link>
          <Link href={links.signUp} className="pl-btn pl-btn-sm">Try it free</Link>
        </nav>
      </header>
      <main>
        <Hero reduce={reduce} />
        <Marquee reduce={reduce} />
        <Showcase reduce={reduce} />
        <section id="moments" className="pl-moments" aria-label="What it does">
          <Moment n="1" color="sun" title="Draw right on the frame." note="the actual note, at the actual frame" src={shots.review} reduce={reduce}>
            Your client circles the thing. You get the circle, the timecode and their words, pinned to that exact moment of V2. Tick it off, export V3, go home.
          </Moment>
          <AiQaMoment reduce={reduce} />
          <Moment n="3" color="mint" title="A little home for every client." note="your logo, not ours" src={shots.portal} reduce={reduce} flip>
            Cuts waiting on them, approved masters to download, invoices and a drop zone for their brand assets. They stop asking for the link. You stop resending it.
          </Moment>
          <FilesMoment reduce={reduce} />
        </section>
        <Price reduce={reduce} />
        <section className="pl-cta" aria-labelledby="pl-cta-title">
          <Scribble className="pl-cta-star" d="M60 8 L72 46 L112 46 L80 70 L92 110 L60 86 L28 110 L40 70 L8 46 L48 46 Z" reduce={reduce} />
          <h2 id="pl-cta-title">Go on.<br />Circle something.</h2>
          <p>{trialDays} days free with every feature. Bring a real project and a fussy client.</p>
          <div className="pl-ctas">
            <Link href={links.signUp} className="pl-btn pl-btn-ink">Start your free trial</Link>
            <Link href={links.signIn} className="pl-btn pl-btn-ghost">I already have an account</Link>
          </div>
        </section>
      </main>
      <footer className="pl-foot">
        <span>{brand} · made by people who have exported “final_v7_REAL.mov”</span>
        <span><Link href="/privacy">Privacy</Link> · <Link href="/terms">Terms</Link> · <Link href="/contact">Say hello</Link></span>
      </footer>
    </div>
  );
}

/** A hand-drawn stroke that draws itself in when it scrolls into view. */
function Scribble({ d, className, reduce, viewBox = "0 0 120 120", width = 3, delay = 0 }: { d: string; className?: string; reduce: boolean; viewBox?: string; width?: number; delay?: number }) {
  return (
    <svg className={className} viewBox={viewBox} fill="none" aria-hidden="true">
      <motion.path d={d} stroke="currentColor" strokeWidth={width} strokeLinecap="round" strokeLinejoin="round"
        initial={reduce ? false : { pathLength: 0 }} whileInView={{ pathLength: 1 }} viewport={{ once: true, margin: "-15%" }}
        transition={{ duration: 0.9, ease: "easeInOut", delay }} />
    </svg>
  );
}

/** A card that tilts toward the pointer in 3D, on springs. */
function Tilt({ children, className, reduce, max = 12 }: { children: ReactNode; className?: string; reduce: boolean; max?: number }) {
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rx = useSpring(useTransform(y, [-0.5, 0.5], [max, -max]), springy);
  const ry = useSpring(useTransform(x, [-0.5, 0.5], [-max, max]), springy);
  const onMove = useCallback((e: PointerEvent<HTMLDivElement>) => {
    if (reduce || e.pointerType !== "mouse") return;
    const r = e.currentTarget.getBoundingClientRect();
    x.set((e.clientX - r.left) / r.width - 0.5);
    y.set((e.clientY - r.top) / r.height - 0.5);
  }, [reduce, x, y]);
  const reset = () => { x.set(0); y.set(0); };
  return (
    <div className={`pl-tilt ${className ?? ""}`} onPointerMove={onMove} onPointerLeave={reset}>
      <motion.div className="pl-tilt-inner" style={reduce ? undefined : { rotateX: rx, rotateY: ry }}>{children}</motion.div>
    </div>
  );
}

function Hero({ reduce }: { reduce: boolean }) {
  const { scrollY } = useScroll();
  const bob = useTransform(scrollY, [0, 600], [0, -80]);
  const bob2 = useTransform(scrollY, [0, 600], [0, -140]);
  const spin = useTransform(scrollY, [0, 600], [0, 120]);
  const pop = (i: number) => (reduce ? {} : { initial: { scale: 0, rotate: -20 }, animate: { scale: 1, rotate: 0 }, transition: { ...springy, delay: 0.5 + i * 0.12 } });
  return (
    <section className="pl-hero" aria-labelledby="pl-hero-title">
      <div className="pl-hero-copy">
        <p className="pl-eyebrow">Review + approvals for video people</p>
        <h1 id="pl-hero-title">
          <span className="pl-w pl-w-circle">Circle it.<Scribble className="pl-s-circle" viewBox="0 0 300 120" d="M150 10 C60 6 10 30 14 62 C18 98 110 112 190 106 C270 100 296 70 286 44 C276 16 210 8 120 16" reduce={reduce} delay={0.4} /></span>{" "}
          <span className="pl-w pl-w-scribble">Scribble it.<Scribble className="pl-s-under" viewBox="0 0 300 30" d="M4 18 C30 6 50 28 78 16 C106 4 126 28 154 16 C182 4 204 28 232 16 C256 6 276 24 296 14" reduce={reduce} delay={0.9} /></span>{" "}
          <span className="pl-w pl-w-ship">Ship it.<Scribble className="pl-s-arrow" viewBox="0 0 160 90" d="M150 12 C110 6 60 20 30 64 M30 64 L28 38 M30 64 L54 58" reduce={reduce} delay={1.3} /></span>
        </h1>
        <p className="pl-lede">Your client can finally point at the thing. They draw on the frame, you get the timecode, and nobody types “around the 40-second mark” ever again.</p>
        <div className="pl-ctas">
          <Link href={links.signUp} className="pl-btn">Try it free for {trialDays} days</Link>
          <Link href={links.signIn} className="pl-btn pl-btn-ghost">Log in</Link>
        </div>
      </div>
      <div className="pl-hero-art">
        <motion.span className="pl-clay pl-clay-ball" aria-hidden="true" style={reduce ? undefined : { y: bob2 }} />
        <motion.span className="pl-clay pl-clay-ring" aria-hidden="true" style={reduce ? undefined : { y: bob, rotate: spin }} />
        <motion.span className="pl-clay pl-clay-pill" aria-hidden="true" style={reduce ? undefined : { y: bob2, rotate: spin }} />
        <Tilt className="pl-pile" reduce={reduce} max={14}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="pl-card pl-card-3" src={shots.tasks} alt="" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="pl-card pl-card-2" src={shots.aiqaPoster} alt="" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="pl-card pl-card-1" src={shots.review} alt={`${brand} review screen with a circle drawn on the frame and comments`} />
        </Tilt>
        <motion.span className="pl-sticker pl-sticker-ok" {...pop(0)}><Check aria-hidden="true" />V3 approved!</motion.span>
        <motion.span className="pl-sticker pl-sticker-round" {...pop(1)}>{trialDays} days<br />free</motion.span>
        <motion.span className="pl-sticker pl-sticker-tc" {...pop(2)}>00:02 · “hold on the cup”</motion.span>
      </div>
    </section>
  );
}

function Marquee({ reduce }: { reduce: boolean }) {
  const items = ["edit suites", "motion studios", "social teams", "post houses", "freelance editors", "anyone who has exported final_v7_REAL.mov"];
  const row = <span>{items.map((t) => <b key={t}>{t}<Asterisk aria-hidden="true" /></b>)}</span>;
  return (
    <div className="pl-marquee" aria-label={`Built for ${items.slice(0, 5).join(", ")}`}>
      <div className={reduce ? "" : "is-moving"} aria-hidden="true">{row}{row}</div>
    </div>
  );
}

function Showcase({ reduce }: { reduce: boolean }) {
  const ref = useRef<HTMLElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const noop = useCallback(() => {}, []);
  useAutoplay(video, noop);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "center center"] });
  const p = useSpring(scrollYProgress, { stiffness: 120, damping: 20 });
  const rx = useTransform(p, [0, 1], [32, 0]);
  const rz = useTransform(p, [0, 1], [-6, -1.5]);
  const sc = useTransform(p, [0, 1], [0.82, 1]);
  return (
    <section ref={ref} className="pl-show" aria-labelledby="pl-show-title">
      <h2 id="pl-show-title">Here’s the actual app. <span>Real screens, real clicks.</span></h2>
      <div className="pl-tv-wrap">
        <motion.div className="pl-tv" style={reduce ? { rotate: -1.5 } : { rotateX: rx, rotate: rz, scale: sc }}>
          <video ref={video} muted loop playsInline preload="metadata" poster={shots.poster} aria-label={`${brand} product tour`}>
            <source src={clip.webm} type="video/webm" />
            <source src={clip.mp4} type="video/mp4" />
          </video>
        </motion.div>
        <p className="pl-hand pl-hand-tv">27 seconds, real clicks<Scribble className="pl-s-tv" viewBox="0 0 120 80" d="M8 8 C40 10 80 30 104 66 M104 66 L80 62 M104 66 L106 42" reduce={reduce} /></p>
      </div>
    </section>
  );
}

function Moment({ n, color, title, note, src, children, reduce, flip }: { n: string; color: string; title: string; note: string; src: string; children: ReactNode; reduce: boolean; flip?: boolean }) {
  return (
    <article className={`pl-moment is-${color}${flip ? " is-flip" : ""}`} aria-labelledby={`pl-m-${n}`}>
      <motion.div className="pl-moment-copy" initial={reduce ? false : { opacity: 0, y: 40 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-10%" }} transition={springy}>
        <span className="pl-num" aria-hidden="true">{n}</span>
        <h3 id={`pl-m-${n}`}>{title}</h3>
        <p>{children}</p>
      </motion.div>
      <motion.div className="pl-moment-art" initial={reduce ? false : { opacity: 0, rotate: flip ? 8 : -8, y: 60 }} whileInView={{ opacity: 1, rotate: flip ? 2 : -2, y: 0 }} viewport={{ once: true, margin: "-10%" }} transition={{ ...springy, delay: 0.1 }}>
        <Tilt reduce={reduce}>
          <figure className="pl-polaroid">
            <span className="pl-tape" aria-hidden="true" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt={`${title} (${brand} screenshot)`} loading="lazy" decoding="async" />
            <figcaption className="pl-hand">{note}</figcaption>
          </figure>
        </Tilt>
      </motion.div>
    </article>
  );
}

function AiQaMoment({ reduce }: { reduce: boolean }) {
  return (
    <article className="pl-moment is-tomato is-flip pl-qa" aria-labelledby="pl-m-2">
      <motion.div className="pl-moment-copy" initial={reduce ? false : { opacity: 0, y: 40 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-10%" }} transition={springy}>
        <span className="pl-num" aria-hidden="true">2</span>
        <h3 id="pl-m-2">A proofreader that never gets bored.</h3>
        <p>AI Visual QA reads the words on your poster or in your titles, checks them against the copy the client signed off, and flags the slips right on the frame. It only suggests. You decide what to fix.</p>
      </motion.div>
      <div className="pl-moment-art">
        <div className="pl-typo" aria-label="Example: PREMUIM corrected to PREMIUM">
          <span className="pl-typo-word" aria-hidden="true">
            PREMUIM
            <svg className="pl-typo-strike" viewBox="0 0 400 60" aria-hidden="true"><motion.path d="M6 38 C90 22 200 44 394 18" stroke="currentColor" strokeWidth="9" strokeLinecap="round" fill="none" initial={reduce ? false : { pathLength: 0 }} whileInView={{ pathLength: 1 }} viewport={{ once: true }} transition={{ duration: 0.5, delay: 0.3 }} /></svg>
          </span>
          <motion.span className="pl-typo-fix pl-hand" aria-hidden="true" initial={reduce ? false : { opacity: 0, scale: 0.6, rotate: -14 }} whileInView={{ opacity: 1, scale: 1, rotate: -6 }} viewport={{ once: true }} transition={{ ...springy, delay: 0.8 }}>PREMIUM!</motion.span>
          <Tilt reduce={reduce} className="pl-typo-shot">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={shots.aiqaPoster} alt={`AI Visual QA in ${brand} flagging PREMUIM on a poster`} loading="lazy" decoding="async" />
          </Tilt>
        </div>
      </div>
    </article>
  );
}

function FilesMoment({ reduce }: { reduce: boolean }) {
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 80%", "center 40%"] });
  const p = useSpring(scrollYProgress, { stiffness: 70, damping: 18 });
  const width = useTransform(p, [0, 1], ["4%", "100%"]);
  const left = useTransform(p, [0, 1], ["0%", "96%"]);
  const pct = useTransform(p, (v) => `${Math.round(Math.min(1, Math.max(0, v)) * 1000)} MB`);
  return (
    <article ref={ref} className="pl-moment is-sky pl-files" aria-labelledby="pl-m-4">
      <motion.div className="pl-moment-copy" initial={reduce ? false : { opacity: 0, y: 40 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-10%" }} transition={springy}>
        <span className="pl-num" aria-hidden="true">4</span>
        <h3 id="pl-m-4">Big files? Throw them in.</h3>
        <p>Masters up to 1 GB upload in the background while you carry on cutting. Everything files itself by client and project and opens straight into review.</p>
      </motion.div>
      <div className="pl-moment-art">
        <div className="pl-upload" aria-hidden="true">
          <p><UploadCloud /> master_v7_FINAL_actually.mov <motion.b>{reduce ? "1000 MB" : pct}</motion.b></p>
          <div className="pl-bar-track">
            <motion.i style={{ width: reduce ? "100%" : width }} />
            <motion.span className="pl-clay pl-clay-roll" style={reduce ? { left: "96%" } : { left }} />
          </div>
        </div>
        <Tilt reduce={reduce}>
          <figure className="pl-polaroid is-wide">
            <span className="pl-tape" aria-hidden="true" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={shots.files} alt={`Files browser in ${brand}`} loading="lazy" decoding="async" />
            <figcaption className="pl-hand"><Paperclip aria-hidden="true" /> sorted by client, all by itself</figcaption>
          </figure>
        </Tilt>
      </div>
    </article>
  );
}

function Price({ reduce }: { reduce: boolean }) {
  return (
    <section id="price" className="pl-price" aria-labelledby="pl-price-title">
      <div className="pl-price-copy">
        <h2 id="pl-price-title">One price. Everything in.</h2>
        <ul>
          <li><Check aria-hidden="true" />Review links your clients can use without an account</li>
          <li><Check aria-hidden="true" />Drawings, voice notes, versions and approvals</li>
          <li><Check aria-hidden="true" />AI Visual QA, client portal, files and tasks</li>
        </ul>
        <Link href={links.signUp} className="pl-btn">Start the {trialDays}-day trial</Link>
      </div>
      <motion.div className="pl-tag" initial={reduce ? false : { rotate: -28 }} whileInView={{ rotate: [-28, 14, -8, 5, -2, 0] }} viewport={{ once: true }} transition={{ duration: 1.8, ease: "easeOut" }}>
        <span className="pl-tag-string" aria-hidden="true" />
        <div className="pl-tag-body">
          <small>Pro</small>
          <b>{price}</b>
          <span>a month, in GBP</span>
          <em className="pl-hand">first {trialDays} days on us</em>
        </div>
      </motion.div>
    </section>
  );
}
