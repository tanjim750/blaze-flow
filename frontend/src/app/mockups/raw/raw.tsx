"use client";

import Link from "next/link";
import { useCallback, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { motion, useScroll, useSpring, useTransform } from "motion/react";
import { brand, clip, links, price, shots, timecode, trialDays, useAutoplay, useReducedMotionSafe } from "@/components/mockups/shared";

/*
 * RAW direction. Brutalist and tool-like: a visible 12-column grid, Space Mono throughout,
 * stark black on paper with one accent (signal blue), a rotating wireframe 3D timeline,
 * terminal output, and crisp, snappy wipes instead of soft fades.
 */

const snap = { duration: 0.42, ease: [0.9, 0, 0.1, 1] } as const;
const handle = brand.toUpperCase().replace(/\s+/g, "_");

export function Raw() {
  const reduce = useReducedMotionSafe();
  const [xy, setXy] = useState({ x: 0, y: 0 });
  const onMove = (e: PointerEvent) => setXy({ x: Math.round(e.clientX), y: Math.round(e.clientY) });
  return (
    <div className="rw" onPointerMove={onMove} data-reduce={reduce || undefined}>
      <div className="rw-grid" aria-hidden="true">{Array.from({ length: 12 }, (_, i) => <i key={i} />)}</div>
      <header className="rw-bar">
        <Link href="/mockups/raw" className="rw-logo">[{handle}]</Link>
        <span className="rw-xy" aria-hidden="true">X:{String(xy.x).padStart(4, "0")} Y:{String(xy.y).padStart(4, "0")}</span>
        <nav aria-label="Main">
          <a href="#modules">MODULES</a>
          <a href="#plan">PLAN</a>
          <Link href={links.signIn}>LOG_IN</Link>
          <Link href={links.signUp} className="rw-btn is-accent">START_TRIAL →</Link>
        </nav>
      </header>
      <main>
        <Hero reduce={reduce} />
        <Tour />
        <section id="modules" className="rw-modules" aria-labelledby="rw-mod-title">
          <div className="rw-sechead"><span>§02</span><h2 id="rw-mod-title">MODULES</h2><span>4 OF 9 SHOWN</span></div>
          <Module id="M01" name="REVIEW" tags={["frame-accurate", "drawings", "versions"]} src={shots.review} reduce={reduce} extra={<AnnotationLog />}>
            Clients click a frame and draw on it. Every note carries a timecode, a shape and an author, and sits in one list you work down before exporting the next version. Team-only notes never reach the client.
          </Module>
          <Module id="M02" name="AI_VISUAL_QA" tags={["ocr", "spelling", "vs approved copy"]} src={shots.aiqaPoster} reduce={reduce} extra={<Diff />} flip>
            Reads every line of on-screen text in a poster or a cut, spell-checks it and diffs it against the copy the client approved. Findings are boxed on the frame, with time ranges on video. Suggestions only; a human accepts each one.
          </Module>
          <Module id="M03" name="CLIENT_PORTAL" tags={["branded", "deliverables", "sign-off"]} src={shots.portal} reduce={reduce} extra={<PortalStat />}>
            One address per client with your logo on it: cuts waiting on them, approved masters to download, invoices, and a drop zone for their assets. Every approval leaves a record.
          </Module>
          <Module id="M04" name="FILES" tags={["1 GB uploads", "background", "by client"]} src={shots.files} reduce={reduce} extra={<Ingest reduce={reduce} />} flip>
            Drop a master and keep cutting; uploads up to 1 GB run in the background. Files sort by client and project, show duration and review stage, and open straight into review.
          </Module>
        </section>
        <Plan reduce={reduce} />
        <section className="rw-cta" aria-labelledby="rw-cta-title">
          <h2 id="rw-cta-title">SHIP THE <span className="rw-nowrap">CUT.<span className="rw-cursor" aria-hidden="true" /></span></h2>
          <div className="rw-cta-row">
            <p>{trialDays} days free. Then {price}/month. No sales call.</p>
            <Link href={links.signUp} className="rw-btn is-accent is-big">[ START_TRIAL ]</Link>
            <Link href={links.signIn} className="rw-btn is-big">[ LOG_IN ]</Link>
          </div>
        </section>
      </main>
      <footer className="rw-foot">
        <span>{handle} · REVIEW / APPROVE / DELIVER</span>
        <span><Link href="/privacy">PRIVACY</Link> <Link href="/terms">TERMS</Link> <Link href="/contact">CONTACT</Link></span>
        <span>EOF</span>
      </footer>
    </div>
  );
}

function Hero({ reduce }: { reduce: boolean }) {
  const { scrollY } = useScroll();
  const extra = useSpring(useTransform(scrollY, [0, 900], [0, 70]), { stiffness: 200, damping: 30 });
  const lines: [string, string][] = [
    ["$", "bf ingest A002_master_v7.mov --project spring"],
    ["→", "uploading 1.00 GB ................ OK"],
    ["$", "bf share v7 --client northlight --allow-approve"],
    ["→", "link sent · 3 notes @ 00:02, 00:05, 00:12"],
    ["$", "bf qa poster_v1.png --against approved_copy"],
    ["ERR", "'PREMUIM' expected 'PREMIUM'      [HIGH]"],
    ["ERR", "'50%' expected '40%'               [HIGH]"],
    ["→", "v7 APPROVED by rachel@client · 18:42"],
  ];
  return (
    <section className="rw-hero" aria-labelledby="rw-hero-title">
      <div className="rw-hero-l">
        <div className="rw-sechead"><span>§01</span><span>{handle}</span><span>BUILD 2026.10</span></div>
        <motion.h1 id="rw-hero-title" initial={reduce ? false : { clipPath: "inset(0 100% 0 0)" }} animate={{ clipPath: "inset(0 0% 0 0)" }} transition={{ ...snap, duration: 0.7 }}>
          REVIEW.<br />APPROVE.<br />DELIVER.<span className="rw-cursor" aria-hidden="true" />
        </motion.h1>
        <p className="rw-spec">Frame-accurate review for video teams. Clients draw on the frame; you get timecodes, not paragraphs. Proofing, portal, files and tasks in the same tool.</p>
        <div className="rw-row">
          <Link href={links.signUp} className="rw-btn is-accent is-big">[ START {trialDays}-DAY TRIAL ]</Link>
          <Link href={links.signIn} className="rw-btn is-big">[ LOG_IN ]</Link>
        </div>
      </div>
      <div className="rw-hero-r">
        <div className="rw-wire-stage" aria-hidden="true">
          <motion.div className="rw-wire-spin" style={reduce ? undefined : { rotateY: extra }}>
            <div className={`rw-wire ${reduce ? "" : "is-spinning"}`}>
              {["V2", "V1", "A1", "A2"].map((t, i) => (
                <div key={t} className="rw-track" style={{ transform: `translateY(${i * 46 - 70}px) translateZ(${-i * 70}px)` }}>
                  <span className="rw-track-label">{t}</span>
                  {[[4, 22], [30, 18], [52, 30], [86, 10]].map(([l, w], j) => (
                    <div key={j} className={`rw-clip${(i + j) % 3 === 0 ? " is-hot" : ""}`} style={{ left: `${l}%`, width: `${w}%` }}><i /><i /></div>
                  ))}
                </div>
              ))}
              <div className="rw-playhead" />
            </div>
          </motion.div>
          <span className="rw-wire-cap">FIG.00 · TIMELINE, WIREFRAME · 4 TRACKS</span>
        </div>
        <ol className="rw-term" aria-label="Example session">
          {lines.map(([p, l], i) => (
            <motion.li key={i} className={p === "ERR" ? "is-err" : p === "$" ? "is-cmd" : ""} initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.9 + i * 0.28, duration: 0.01 }}>
              <b>{p}</b>{l}
            </motion.li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function Tour() {
  const ref = useRef<HTMLVideoElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [t, setT] = useState(0);
  const [cross, setCross] = useState<{ x: number; y: number } | null>(null);
  const noop = useCallback(() => {}, []);
  useAutoplay(ref, noop);
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setCross({ x: e.clientX - r.left, y: e.clientY - r.top });
  };
  return (
    <section className="rw-tour" aria-labelledby="rw-tour-title">
      <div className="rw-sechead"><span>FIG.01</span><h2 id="rw-tour-title">PRODUCT_TOUR.MP4</h2><span>TC {timecode(t)}</span></div>
      <div ref={box} className="rw-tour-box" onPointerMove={onMove} onPointerLeave={() => setCross(null)}>
        <video ref={ref} muted loop playsInline preload="metadata" poster={shots.poster} aria-label={`${brand} product tour`} onTimeUpdate={(e) => setT(e.currentTarget.currentTime)}>
          <source src={clip.webm} type="video/webm" />
          <source src={clip.mp4} type="video/mp4" />
        </video>
        {cross && <>
          <span className="rw-cross-x" style={{ top: cross.y }} aria-hidden="true" />
          <span className="rw-cross-y" style={{ left: cross.x }} aria-hidden="true" />
          <span className="rw-cross-tag" style={{ left: cross.x + 10, top: cross.y + 10 }} aria-hidden="true">{Math.round(cross.x)},{Math.round(cross.y)}</span>
        </>}
        <span className="rw-tick is-tl" aria-hidden="true">0,0</span>
        <span className="rw-tick is-br" aria-hidden="true">1280,800</span>
      </div>
    </section>
  );
}

function Module({ id, name, tags, src, children, extra, reduce, flip }: { id: string; name: string; tags: string[]; src: string; children: ReactNode; extra: ReactNode; reduce: boolean; flip?: boolean }) {
  return (
    <article className={`rw-module${flip ? " is-flip" : ""}`} aria-labelledby={`rw-${id}`}>
      <div className="rw-module-head">
        <span>{id}</span>
        <h3 id={`rw-${id}`}>{name}</h3>
        <span className="rw-tags">{tags.map((t) => <i key={t}>{t}</i>)}</span>
        <span className="rw-status">● LIVE</span>
      </div>
      <div className="rw-module-body">
        <div className="rw-module-copy">
          <p>{children}</p>
          {extra}
        </div>
        <motion.div className="rw-module-shot" initial={reduce ? false : "hidden"} whileInView="shown" viewport={{ once: true, amount: 0.25 }}>
          <div className="rw-shot-frame">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt={`${name.replace(/_/g, " ").toLowerCase()} in ${brand}`} loading="lazy" decoding="async" width={1920} height={1200} />
            {!reduce && <motion.span className="rw-shutter" aria-hidden="true" variants={{ hidden: { scaleY: 1 }, shown: { scaleY: 0 } }} transition={snap} />}
          </div>
        </motion.div>
      </div>
    </article>
  );
}

function AnnotationLog() {
  const rows = [["00:02–00:07", "ellipse", "Hold on the cup a touch longer."], ["00:05", "rect", "Cup reads too orange vs brand swatch."], ["00:10–00:14", "range", "End card: new tagline from approved copy."]];
  return (
    <table className="rw-table">
      <thead><tr><th>TC</th><th>SHAPE</th><th>NOTE</th></tr></thead>
      <tbody>{rows.map((r) => <tr key={r[0]}><td>{r[0]}</td><td>{r[1]}</td><td>{r[2]}</td></tr>)}</tbody>
    </table>
  );
}

function Diff() {
  return (
    <pre className="rw-diff" aria-label="Example diff: PREMUIM corrected to PREMIUM, Recieve to Receive, 50% to 40%">
      <span className="is-file">--- poster_v1.png (read)</span>{"\n"}
      <span className="is-file">+++ approved_copy v1</span>{"\n"}
      <span className="is-del">- PREMUIM QUALITY</span>{"\n"}
      <span className="is-add">+ PREMIUM QUALITY</span>{"\n"}
      <span className="is-del">- Recieve a free tote</span>{"\n"}
      <span className="is-add">+ Receive a free tote bag</span>{"\n"}
      <span className="is-del">- Up to 50% off</span>{"\n"}
      <span className="is-add">+ Up to 40% off</span>
    </pre>
  );
}

function PortalStat() {
  return (
    <dl className="rw-kv">
      <div><dt>client</dt><dd>northlight_coffee</dd></div>
      <div><dt>waiting_on_client</dt><dd>1</dd></div>
      <div><dt>approved</dt><dd>2 (signed off)</dd></div>
      <div><dt>branding</dt><dd>studio logo</dd></div>
    </dl>
  );
}

function Ingest({ reduce }: { reduce: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 90%", "start 30%"] });
  const bar = useTransform(scrollYProgress, (v) => {
    const n = Math.round(Math.min(1, Math.max(0, v)) * 24);
    return `[${"#".repeat(n)}${"-".repeat(24 - n)}] ${String(Math.round((n / 24) * 1024)).padStart(4, " ")}/1024 MB`;
  });
  return (
    <div ref={ref} className="rw-ingest" aria-label="Example: a 1 GB master uploading">
      <span>A002_master_v7.mov</span>
      <motion.code aria-hidden="true">{reduce ? `[${"#".repeat(24)}] 1024/1024 MB` : bar}</motion.code>
    </div>
  );
}

function Plan({ reduce }: { reduce: boolean }) {
  const rows: [string, string][] = [["PLAN", "PRO"], ["PRICE", `${price}.00 / MONTH`], ["CURRENCY", "GBP"], ["TRIAL", `${trialDays} DAYS, ALL MODULES`], ["CLIENT_SEATS", "FREE VIA REVIEW LINKS"], ["UPLOAD_LIMIT", "1 GB / FILE"]];
  return (
    <section id="plan" className="rw-plan" aria-labelledby="rw-plan-title">
      <div className="rw-sechead"><span>§03</span><h2 id="rw-plan-title">PLAN</h2><span>ONE TIER</span></div>
      <div className="rw-plan-body">
        <dl className="rw-receipt">
          {rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
          <Link href={links.signUp} className="rw-btn is-accent is-big">[ START_TRIAL ]</Link>
        </dl>
        <div className="rw-cube-stage" aria-hidden="true">
          <div className={`rw-cube ${reduce ? "" : "is-spinning"}`}>
            {["f", "b", "l", "r", "t", "d"].map((f) => <i key={f} className={`is-${f}`} />)}
            <div className="rw-cube is-inner">{["f", "b", "l", "r", "t", "d"].map((f) => <i key={f} className={`is-${f}`} />)}</div>
          </div>
          <span className="rw-wire-cap">FIG.02 · {price}/MO · NESTED</span>
        </div>
      </div>
    </section>
  );
}
