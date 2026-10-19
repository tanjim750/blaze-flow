"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { animate, motion, useInView, useMotionValueEvent, useScroll, useSpring, useTransform, type MotionValue } from "motion/react";
import { Check, CloudUpload, GripVertical, MessageSquareText } from "lucide-react";
import { useReducedMotionSafe } from "@/components/marketing/motion-prefs";
import { cn } from "@/lib/utils";
import { BOXES, Count, EASE, Pic, Reveal, SUMS, Shot, V3, useLiteMotion } from "./pro-home";

/* ======================================================================================
 * 1. Pinned story: one 3D window that stays put while five chapters scroll past.
 *    Phones, Data Saver and reduced motion get the same chapters as plain sections.
 * ==================================================================================== */

type Chapter = { id: string; title: string; line: string; layers: (active: boolean) => ReactNode; base: ReactNode };

function UploadTray({ active }: { active: boolean }) {
  return (
    <div className="pro-tray">
      <p className="pro-tray-head"><CloudUpload aria-hidden="true" />Uploading 2 files</p>
      {[{ n: "spring_launch_master.mov", s: "1.0 GB", d: 0 }, { n: "poster_v2_final.png", s: "48 MB", d: 0.35 }].map((f) => (
        <div key={f.n} className="pro-tray-row">
          <span>{f.n}</span><small>{f.s}</small>
          <i><motion.b initial={false} animate={{ scaleX: active ? 1 : 0.08 }} transition={{ duration: active ? 2.2 : 0.3, ease: EASE, delay: active ? f.d : 0 }} /></i>
        </div>
      ))}
    </div>
  );
}

const NOTES = [
  { t: "0:04", who: "Rachel Kim", text: "Logo comes in a beat late" },
  { t: "0:12", who: "Rachel Kim", text: "Can the price card hold longer?" },
  { t: "0:21", who: "Sam (client)", text: "Love this shot. Keep it." },
];

function NoteStack({ active }: { active: boolean }) {
  return (
    <div className="pro-notes-float">
      {NOTES.map((n, i) => (
        <motion.div key={n.t} className="pro-note-card" initial={false}
          animate={active ? { opacity: 1, x: 0, rotateY: 0 } : { opacity: 0, x: 80, rotateY: -25 }}
          transition={{ duration: 0.7, ease: EASE, delay: active ? 0.15 + i * 0.18 : 0 }}>
          <span className="pro-note-time">{n.t}</span><b>{n.who}</b><p>{n.text}</p>
        </motion.div>
      ))}
    </div>
  );
}

const fly = (active: boolean, delay: number, x = 0, y = 60) => ({
  initial: false as const,
  animate: active ? { opacity: 1, x: 0, y: 0, scale: 1 } : { opacity: 0, x, y, scale: 0.92 },
  transition: { duration: 0.8, ease: EASE, delay: active ? delay : 0 },
});

const CHAPTERS: Chapter[] = [
  {
    id: "upload", title: "Upload", line: "Masters up to 1 GB upload in the background, sorted by client and project.",
    base: <Shot name="files" sizes="(max-width: 960px) 92vw, 820px" />,
    layers: (a) => <motion.div className="pro-story-layer is-br" {...fly(a, 0.1, 60, 40)}><UploadTray active={a} /></motion.div>,
  },
  {
    id: "review", title: "Review", line: "Clients leave notes and drawings on the exact frame.",
    base: <Shot name="review" sizes="(max-width: 960px) 92vw, 820px" />,
    layers: (a) => <div className="pro-story-layer is-right"><NoteStack active={a} /></div>,
  },
  {
    id: "ai-qa", title: "AI typo check", line: "It reads the text on posters and frames, and boxes what doesn’t match the approved copy.",
    base: <Shot name="aiqaVideo" sizes="(max-width: 960px) 92vw, 820px" />,
    layers: (a) => (<>
      <motion.figure className="pro-story-layer is-tr pro-crop" {...fly(a, 0.1, 80, 0)}><Pic img={V3.finding1} sizes="340px" /></motion.figure>
      <motion.figure className="pro-story-layer is-br pro-crop" {...fly(a, 0.3, 80, 40)}><Pic img={V3.finding3} sizes="340px" /></motion.figure>
    </>),
  },
  {
    id: "portal", title: "Client portal", line: "Clients follow progress and sign off in a portal with your logo.",
    base: <Pic img={V3.portalProject} sizes="(max-width: 960px) 92vw, 820px" />,
    layers: (a) => (<>
      <motion.figure className="pro-story-layer is-bl is-wide pro-crop" {...fly(a, 0.1, -40, 60)}><Pic img={V3.stepper} sizes="600px" /></motion.figure>
      <motion.figure className="pro-story-layer is-br pro-crop" {...fly(a, 0.35, 60, 60)}><Pic img={V3.signoff} sizes="400px" /></motion.figure>
    </>),
  },
  {
    id: "money", title: "Money", line: "Invoices, part payments and what each editor has earned, in one place.",
    base: <Pic img={V3.payouts} sizes="(max-width: 960px) 92vw, 820px" className="pro-story-contain" />,
    layers: (a) => <motion.figure className="pro-story-layer is-bl is-wide pro-crop" {...fly(a, 0.15, -40, 60)}><Pic img={V3.invoiceTotals} sizes="520px" /></motion.figure>,
  },
];

function StoryStage({ progress, active }: { progress: MotionValue<number>; active: number }) {
  const rotY = useTransform(progress, [0, 0.5, 1], [-16, -4, 10]);
  const rotX = useTransform(progress, [0, 1], [10, 4]);
  return (
    <div className="pro-story-stage">
      <motion.div className="pro-story-window" style={{ rotateY: rotY, rotateX: rotX }}>
        {CHAPTERS.map((c, i) => (
          <motion.div key={c.id} className="pro-story-base" aria-hidden={i !== active} initial={false}
            animate={{ opacity: i === active ? 1 : 0, scale: i === active ? 1 : 0.96, z: i === active ? 0 : -80 }}
            transition={{ duration: 0.6, ease: EASE }}>
            {c.base}
          </motion.div>
        ))}
      </motion.div>
      {CHAPTERS.map((c, i) => <div key={c.id} className="pro-story-layers" aria-hidden={i !== active}>{c.layers(i === active)}</div>)}
    </div>
  );
}

export function ProPinnedStory() {
  const lite = useLiteMotion();
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end end"] });
  const progress = useSpring(scrollYProgress, { stiffness: 120, damping: 30, mass: 0.4 });
  const [active, setActive] = useState(0);
  useMotionValueEvent(scrollYProgress, "change", (v) => setActive(Math.min(CHAPTERS.length - 1, Math.max(0, Math.floor(v * CHAPTERS.length)))));
  const bar = useTransform(progress, [0, 1], [0, 1]);

  if (lite) {
    return (
      <section ref={ref} className="pro-story is-stacked" aria-labelledby="pro-story-title">
        <div className="pro-wrap">
          <h2 id="pro-story-title" className="pro-h2">One window. The whole job.</h2>
          {CHAPTERS.map((c, i) => (
            <Reveal key={c.id} className="pro-story-chapter">
              <p className="pro-label">{String(i + 1).padStart(2, "0")} · {c.title}</p>
              <h3 className="pro-story-h3">{c.line}</h3>
              <div className="pro-window">{c.base}</div>
            </Reveal>
          ))}
        </div>
      </section>
    );
  }

  return (
    <section ref={ref} className="pro-story" style={{ height: `${CHAPTERS.length * 90 + 60}vh` }} aria-labelledby="pro-story-title">
      <div className="pro-story-pin">
        <div className="pro-wrap pro-story-grid">
          <div className="pro-story-rail">
            <h2 id="pro-story-title" className="pro-h2">One window.<br />The whole job.</h2>
            <ol className="pro-story-chapters">
              {CHAPTERS.map((c, i) => (
                <li key={c.id} data-active={i === active ? "" : undefined} data-done={i < active ? "" : undefined}>
                  <span className="pro-story-num">{String(i + 1).padStart(2, "0")}</span>
                  <div>
                    <b>{c.title}</b>
                    <motion.p initial={false} animate={{ height: i === active ? "auto" : 0, opacity: i === active ? 1 : 0 }} transition={{ duration: 0.45, ease: EASE }}>{c.line}</motion.p>
                  </div>
                </li>
              ))}
            </ol>
            <div className="pro-story-progress" aria-hidden="true"><motion.span style={{ scaleX: bar }} /></div>
          </div>
          <StoryStage progress={progress} active={active} />
        </div>
      </div>
    </section>
  );
}

/* ======================================================================================
 * 2. Live bento: every tile is a small working demo.
 * ==================================================================================== */

function Tile({ className, title, line, children, delay = 0 }: { className?: string; title: string; line: string; children: ReactNode; delay?: number }) {
  return (
    <Reveal className={cn("pro-live", className)} delay={delay} tilt={14}>
      <div className="pro-live-head"><h3>{title}</h3><p>{line}</p></div>
      <div className="pro-live-body">{children}</div>
    </Reveal>
  );
}

/** Scan line sweeps the poster; each typo box pops as the line passes it. Loops while visible. */
function TypoDemo() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.4 });
  const reduce = useReducedMotionSafe();
  const [y, setY] = useState(reduce ? 100 : 0);
  useEffect(() => {
    if (!inView || reduce) return;
    let stop = () => {};
    const run = () => {
      const c = animate(0, 100, { duration: 3.2, ease: "linear", onUpdate: setY, onComplete: () => { const t = setTimeout(run, 1800); stop = () => clearTimeout(t); } });
      stop = () => c.stop();
    };
    run();
    return () => stop();
  }, [inView, reduce]);
  return (
    <div ref={ref} className="pro-live-poster">
      <Pic img={V3.posterArt} sizes="(max-width: 960px) 80vw, 360px" />
      {!reduce && <span className="pro-scan-line" style={{ top: `${y}%`, opacity: y >= 100 ? 0 : 1 }} aria-hidden="true" />}
      {BOXES.map((b, i) => (
        <motion.span key={i} className="pro-typo-box" aria-hidden="true" style={{ left: `${b.left}%`, top: `${b.top}%`, width: `${b.width}%`, height: `${b.height}%` }}
          initial={false} animate={y >= b.top + b.height / 2 ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 1.5 }}
          transition={{ type: "spring", stiffness: 260, damping: 18 }} />
      ))}
      <p className="pro-live-count" aria-live="off">{BOXES.filter((b) => y >= b.top + b.height / 2).length} of 3 found</p>
    </div>
  );
}

const STAGES = ["Kick-off", "In production", "Your review", "Signed off", "Delivered"];
function PortalDemo() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.5 });
  const reduce = useReducedMotionSafe();
  const [step, setStep] = useState(reduce ? 3 : 0);
  useEffect(() => {
    if (!inView || reduce) return;
    const ids = [1, 2, 3].map((s) => setTimeout(() => setStep(s), s * 700));
    return () => ids.forEach(clearTimeout);
  }, [inView, reduce]);
  return (
    <div ref={ref} className="pro-live-portal">
      <p className="pro-live-big">{Math.round((step / (STAGES.length - 1)) * 100)}%</p>
      <div className="pro-live-track"><motion.span initial={false} animate={{ scaleX: step / (STAGES.length - 1) }} transition={{ duration: 0.7, ease: EASE }} /></div>
      <ol className="pro-live-stages">{STAGES.map((s, i) => <li key={s} data-done={i <= step ? "" : undefined}>{i <= step && <Check aria-hidden="true" />}{s}</li>)}</ol>
    </div>
  );
}

function MoneyDemo() {
  return (
    <dl className="pro-live-money">
      {SUMS.slice(0, 3).map((s) => (
        <div key={s.label}><dt>{s.label}</dt><dd><Count value={s.value} prefix="£" /></dd></div>
      ))}
      <p className="pro-live-foot">Demo studio, billed in GBP</p>
    </dl>
  );
}

const SCRUB = [
  { at: 4, t: "0:04", text: "Logo comes in a beat late" },
  { at: 12, t: "0:12", text: "Hold the price card longer" },
  { at: 21, t: "0:21", text: "Keep this shot" },
];
/** A scrubber over a 30-second cut. Notes appear once the playhead passes their time. */
function ReviewDemo() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.5 });
  const reduce = useReducedMotionSafe();
  const [t, setT] = useState(reduce ? 30 : 0);
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (!inView || reduce || touched) return;
    const c = animate(0, 30, { duration: 6, ease: "linear", onUpdate: setT, repeat: Infinity, repeatDelay: 1.5 });
    return () => c.stop();
  }, [inView, reduce, touched]);
  const fmt = (s: number) => `0:${String(Math.floor(s)).padStart(2, "0")}`;
  return (
    <div ref={ref} className="pro-live-review">
      <div className="pro-live-frame"><Pic img={{ src: "/marketing/demo-poster.webp", w: 1280, h: 800, alt: "" }} sizes="(max-width: 960px) 80vw, 420px" decorative />
        {SCRUB.map((n) => t >= n.at && <motion.span key={n.at} className="pro-live-pin" style={{ left: `${(n.at / 30) * 100}%` }} initial={{ scale: 0 }} animate={{ scale: 1 }} aria-hidden="true">{SCRUB.indexOf(n) + 1}</motion.span>)}
      </div>
      <label className="pro-live-scrub">
        <span className="pro-sr">Playhead</span>
        <input type="range" min={0} max={30} step={0.1} value={t} onChange={(e) => { setTouched(true); setT(Number(e.target.value)); }} aria-valuetext={fmt(t)} />
        <output>{fmt(t)} / 0:30</output>
      </label>
      <ul className="pro-live-notes">
        {SCRUB.map((n, i) => (
          <motion.li key={n.at} initial={false} animate={t >= n.at ? { opacity: 1, y: 0 } : { opacity: 0.18, y: 6 }} transition={{ duration: 0.3 }}>
            <span>{i + 1}</span><b>{n.t}</b>{n.text}
          </motion.li>
        ))}
      </ul>
    </div>
  );
}

const COLS = ["To do", "In progress", "Done"];
/** Drag the card between columns (or use the button: keyboard and touch friendly). */
function TasksDemo() {
  const board = useRef<HTMLDivElement>(null);
  const [col, setCol] = useState(0);
  const reduce = useReducedMotionSafe();
  const drop = (x: number) => {
    const r = board.current?.getBoundingClientRect();
    if (!r) return;
    setCol(Math.max(0, Math.min(2, Math.floor(((x - r.left) / r.width) * 3))));
  };
  return (
    <div className="pro-live-tasks">
      <div ref={board} className="pro-live-board">
        {COLS.map((c, i) => (
          <div key={c} className="pro-live-col">
            <p>{c}</p>
            {i === 1 && <div className="pro-live-ghost">Colour grade, hero spot</div>}
            {i === col && (
              <motion.div layoutId={reduce ? undefined : "pro-task"} className="pro-live-task" drag={!reduce} dragSnapToOrigin
                onDragEnd={(_, info) => drop(info.point.x - window.scrollX)} whileDrag={{ scale: 1.06, rotate: -3, zIndex: 5 }}>
                <GripVertical aria-hidden="true" /><span><b>Fix PREMUIM on poster</b><small><MessageSquareText aria-hidden="true" />From note 0:12 · V2</small></span>
              </motion.div>
            )}
          </div>
        ))}
      </div>
      <button type="button" className="pro-btn is-ghost is-sm" onClick={() => setCol((c) => (c + 1) % 3)}>
        Move card to {COLS[(col + 1) % 3]}
      </button>
    </div>
  );
}

export function ProLiveBento() {
  return (
    <section className="pro-bento-live" aria-labelledby="pro-live-title">
      <div className="pro-wrap">
        <Reveal><h2 id="pro-live-title" className="pro-h2 is-center">Every tile is the app, running</h2></Reveal>
        <div className="pro-live-grid">
          <Tile className="is-typo" title="AI typo check" line="Watch it find the three mistakes on this poster."><TypoDemo /></Tile>
          <Tile className="is-portal" title="Client portal" line="Progress your client sees." delay={0.1}><PortalDemo /></Tile>
          <Tile className="is-money" title="Money" line="From the demo studio’s Money page." delay={0.2}><MoneyDemo /></Tile>
          <Tile className="is-review" title="Review on the frame" line="Drag the playhead. Notes appear at their time."><ReviewDemo /></Tile>
          <Tile className="is-tasks" title="Tasks from notes" line="Drag the card to another column." delay={0.1}><TasksDemo /></Tile>
        </div>
      </div>
    </section>
  );
}
