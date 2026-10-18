"use client";

import Link from "next/link";
import { useCallback, useRef, useState, type ReactNode } from "react";
import { motion, useScroll, useSpring, useTransform, type MotionValue } from "motion/react";
import { brand, clip, links, price, shots, timecode, trialDays, useAutoplay, useReducedMotionSafe } from "@/components/mockups/shared";

/*
 * CINEMATIC direction. Dark, graded, film-like: grain, letterbox, burnt-in timecode, a
 * scrubbing playhead, and a 3D film strip the camera travels through on scroll (CSS 3D).
 * Accent: tungsten amber. Fonts: Instrument Serif (display) + IBM Plex Mono (timecode/UI).
 */

const REEL = [
  { src: shots.review, label: "REVIEW", tc: "01:00:02:00" },
  { src: shots.aiqaPoster, label: "AI QA · POSTER", tc: "01:00:07:12" },
  { src: shots.aiqaVideo, label: "AI QA · VIDEO", tc: "01:00:11:03" },
  { src: shots.portal, label: "CLIENT PORTAL", tc: "01:00:15:20" },
  { src: shots.files, label: "FILES", tc: "01:00:19:08" },
  { src: shots.tasks, label: "TASKS", tc: "01:00:23:16" },
];

export function Cinematic() {
  const reduce = useReducedMotionSafe();
  const { scrollY } = useScroll();
  const pageTc = useTransform(scrollY, (y) => timecode(y / 55));
  return (
    <div className="cn" data-reduce={reduce || undefined}>
      <div className="cn-grain" aria-hidden="true" />
      <header className="cn-bar">
        <Link href="/mockups/cinematic" className="cn-slate"><i aria-hidden="true" />{brand}</Link>
        <span className="cn-bar-tc" aria-hidden="true"><b>REC</b><motion.span>{pageTc}</motion.span></span>
        <nav className="cn-bar-nav" aria-label="Main">
          <a href="#scenes">Features</a>
          <a href="#rate-card">Pricing</a>
          <Link href={links.signIn}>Log in</Link>
          <Link href={links.signUp} className="cn-btn cn-btn-sm">Start trial</Link>
        </nav>
      </header>
      <main>
        <Hero reduce={reduce} />
        <Reel reduce={reduce} />
        <section id="scenes" className="cn-scenes" aria-label="Features">
          <Scene n="01" slug="REVIEW" take="INT. EDIT SUITE — LATE" src={shots.review} title={<>“The logo, around 0:40?” <em>Which</em> logo. <em>Which</em> 0:40.</>} reduce={reduce} markers={[8, 22, 23, 41, 60, 77]}>
            Clients click the frame and draw on it. You get a timecode, a circle around the problem and a list you can tick off before you export V4. Internal notes stay internal; the client only sees theirs.
          </Scene>
          <Scene n="02" slug="AI VISUAL QA" take="POSTER v1 · PROOF" src={shots.aiqaPoster} title={<>PREMUIM. <em>Caught</em> before it went to print.</>} reduce={reduce} subtitle="PREMUIM → PREMIUM · Recieve → Receive · 50% → 40%" flip markers={[30, 31, 52]}>
            Run AI Visual QA on a poster or a cut. It reads every line of on-screen text, checks it against the copy the client signed off, and boxes each slip on the frame, with a time range on video. It suggests. You decide.
          </Scene>
          <Scene n="03" slug="CLIENT PORTAL" take="EXT. CLIENT INBOX — DAY" src={shots.portal} title={<>One link per client. <em>Your</em> logo on it.</>} reduce={reduce} markers={[12, 48]}>
            Cuts waiting on them, approved masters to download, invoices, and a drop zone for their brand assets. Fewer “can you resend the link?” emails, and a sign-off record when it matters.
          </Scene>
          <Scene n="04" slug="FILES + UPLOADS" take="INGEST · A002" src={shots.files} title={<>1 GB masters, uploading <em>while</em> you keep cutting.</>} reduce={reduce} ingest flip markers={[66]}>
            Drop the export and carry on. Footage, stills and PDFs sort themselves by client and project, show duration and review stage, and open straight into review.
          </Scene>
        </section>
        <RateCard />
        <section className="cn-cta" aria-labelledby="cn-cta-title">
          <p className="cn-kicker">FADE OUT</p>
          <h2 id="cn-cta-title">Cut to black.<br /><em>Then cut to approved.</em></h2>
          <div className="cn-ctas">
            <Link href={links.signUp} className="cn-btn">Start your {trialDays}-day trial</Link>
            <Link href={links.signIn} className="cn-btn cn-btn-ghost">Log in</Link>
          </div>
        </section>
      </main>
      <footer className="cn-credits">
        <p>A {brand} production</p>
        <p><Link href="/privacy">Privacy</Link> · <Link href="/terms">Terms</Link> · <Link href="/contact">Contact</Link></p>
      </footer>
    </div>
  );
}

function Hero({ reduce }: { reduce: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [t, setT] = useState(0);
  const [d, setD] = useState(27.5);
  const noop = useCallback(() => {}, []);
  useAutoplay(ref, noop);
  const markers = [7, 18, 26, 47, 58, 81];
  return (
    <section className="cn-hero" aria-labelledby="cn-hero-title">
      <div className="cn-monitor">
        <video
          ref={ref}
          muted loop playsInline preload="metadata" poster={shots.poster}
          aria-label={`${brand} product tour: dashboard, files, review with drawings, AI Visual QA and tasks`}
          onTimeUpdate={(e) => setT(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => setD(e.currentTarget.duration || 27.5)}
        >
          <source src={clip.webm} type="video/webm" />
          <source src={clip.mp4} type="video/mp4" />
        </video>
        <motion.span className="cn-letterbox is-top" aria-hidden="true" initial={reduce ? false : { scaleY: 0 }} animate={{ scaleY: 1 }} transition={{ duration: 1.4, ease: [0.7, 0, 0.2, 1], delay: 0.2 }} />
        <motion.span className="cn-letterbox is-bottom" aria-hidden="true" initial={reduce ? false : { scaleY: 0 }} animate={{ scaleY: 1 }} transition={{ duration: 1.4, ease: [0.7, 0, 0.2, 1], delay: 0.2 }} />
        <div className="cn-safe" aria-hidden="true"><i /><i /><i /><i /></div>
        <div className="cn-burnin is-tl" aria-hidden="true">A001_C014 · REVIEW PROXY · 1280×800</div>
        <div className="cn-burnin is-tr" aria-hidden="true">TC {timecode(t)}</div>
        <div className="cn-hero-copy">
          <motion.p className="cn-kicker" initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.2 }}>{brand.toUpperCase()} · REVIEW AND DELIVERY FOR VIDEO AGENCIES</motion.p>
          <motion.h1 id="cn-hero-title" initial={reduce ? false : { opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1, duration: 1.1, ease: [0.2, 0.7, 0.2, 1] }}>
            Notes on the frame,<br /><em>not</em> in the email chain.
          </motion.h1>
          <motion.div className="cn-hero-sub" initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.5, duration: 0.8 }}>
            <p>Upload the cut, send one link, and every note lands on the exact frame it’s about. No more “around the 40-second mark”.</p>
            <div className="cn-ctas">
              <Link href={links.signUp} className="cn-btn">Start {trialDays}-day trial</Link>
              <Link href={links.signIn} className="cn-btn cn-btn-ghost">Log in</Link>
            </div>
          </motion.div>
        </div>
      </div>
      <div className="cn-scrubber" aria-hidden="true">
        <span className="cn-scrubber-tc">{timecode(t, false)}</span>
        <div className="cn-track">
          {markers.map((m) => <i key={m} style={{ left: `${m}%` }} />)}
          <b style={{ left: `${(t / d) * 100}%` }} />
        </div>
        <span className="cn-scrubber-tc">{timecode(d, false)}</span>
      </div>
    </section>
  );
}

function Reel({ reduce }: { reduce: boolean }) {
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const p = useSpring(scrollYProgress, { stiffness: 80, damping: 24, mass: 0.6 });
  const z = useTransform(p, [0, 1], [-900, 1100]);
  const ry = useTransform(p, [0, 1], [-34, 18]);
  const rx = useTransform(p, [0, 1], [10, -4]);
  const frame = useTransform(p, (v) => `FRAME ${String(Math.min(REEL.length, Math.max(1, Math.ceil(v * REEL.length)))).padStart(2, "0")} / ${String(REEL.length).padStart(2, "0")}`);
  return (
    <section ref={ref} className="cn-reel" aria-labelledby="cn-reel-title">
      <div className="cn-reel-stage">
        <div className="cn-reel-copy">
          <p className="cn-kicker">THE REEL</p>
          <h2 id="cn-reel-title">Every version, every note, <em>one reel.</em></h2>
          <p>Review, proofing, client sign-off, files and tasks. All of it hangs off the same frames, so nothing gets lost between the edit and the inbox.</p>
          <motion.span className="cn-frame-count" aria-hidden="true">{frame}</motion.span>
        </div>
        <div className="cn-reel-camera" aria-hidden="true">
          <motion.div className="cn-reel-rig" style={reduce ? { transform: "translateZ(-200px) rotateY(-18deg) rotateX(6deg)" } : { z, rotateY: ry, rotateX: rx }}>
            {REEL.map((f, i) => (
              <figure key={f.src} className="cn-film" style={{ transform: `translate3d(${i * 9}vw, ${i % 2 ? -14 : 14}px, ${-i * 340}px)` }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={f.src} alt="" loading="lazy" decoding="async" />
                <figcaption><span>{f.label}</span><span>{f.tc}</span></figcaption>
              </figure>
            ))}
          </motion.div>
        </div>
      </div>
    </section>
  );
}

function Scene({ n, slug, take, src, title, children, reduce, subtitle, ingest, flip, markers }: {
  n: string; slug: string; take: string; src: string; title: ReactNode; children: ReactNode; reduce: boolean;
  subtitle?: string; ingest?: boolean; flip?: boolean; markers: number[];
}) {
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 85%", "end 35%"] });
  const p = useSpring(scrollYProgress, { stiffness: 90, damping: 26 });
  const tilt = useTransform(p, [0, 0.5, 1], [14, 0, -6]);
  const scale = useTransform(p, [0, 0.5], [0.9, 1]);
  const head = useTransform(p, (v) => `${Math.min(100, Math.max(0, v * 100))}%`);
  const tc = useTransform(p, (v) => timecode(v * 18));
  const ingestPct = useTransform(p, (v) => `${Math.round(Math.min(1, Math.max(0, v * 1.4)) * 100)}%`);
  return (
    <article ref={ref} className={`cn-scene${flip ? " is-flip" : ""}`} aria-labelledby={`cn-scene-${n}`}>
      <div className="cn-slateline" aria-hidden="true"><b>SCENE {n}</b><span>{slug}</span><span>{take}</span></div>
      <div className="cn-scene-grid">
        <div className="cn-scene-copy">
          <h3 id={`cn-scene-${n}`}>{title}</h3>
          <p>{children}</p>
        </div>
        <div className="cn-scene-media">
          <motion.div className="cn-scene-frame" style={reduce ? undefined : { rotateX: tilt, scale }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt={`${slug.toLowerCase()} screen in ${brand}`} loading="lazy" decoding="async" />
            <motion.span className="cn-burnin is-br" aria-hidden="true">{tc as MotionValue<string>}</motion.span>
            {subtitle && <span className="cn-subtitle">{subtitle}</span>}
          </motion.div>
          <div className="cn-mini" aria-hidden="true">
            {markers.map((m) => <i key={m} style={{ left: `${m}%` }} />)}
            <motion.b style={{ left: reduce ? "50%" : head }} />
          </div>
          {ingest && (
            <div className="cn-ingest" aria-hidden="true">
              <span>A002_master_v7_FINAL.mov</span><span>1.00 GB</span>
              <div><motion.i style={{ width: reduce ? "100%" : ingestPct }} /></div>
              <motion.span>{reduce ? "100%" : ingestPct}</motion.span>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

function RateCard() {
  const rows: [string, string][] = [
    ["Pro", `${price} a month`],
    ["Free trial", `${trialDays} days, the whole thing`],
    ["Billed in", "GBP"],
    ["Client seats", "Clients review free through links"],
    ["Uploads", "Up to 1 GB a file"],
    ["AI Visual QA", "Included"],
  ];
  return (
    <section id="rate-card" className="cn-rate" aria-labelledby="cn-rate-title">
      <p className="cn-kicker">RATE CARD</p>
      <h2 id="cn-rate-title">One plan. <em>{price}</em> a month.</h2>
      <dl>
        {rows.map(([k, v], i) => (
          <motion.div key={k} initial={{ opacity: 0, y: 18 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-10%" }} transition={{ delay: i * 0.08, duration: 0.6 }}>
            <dt>{k}</dt><dd>{v}</dd>
          </motion.div>
        ))}
      </dl>
      <Link href={links.signUp} className="cn-btn">Roll camera. Start the trial</Link>
    </section>
  );
}
