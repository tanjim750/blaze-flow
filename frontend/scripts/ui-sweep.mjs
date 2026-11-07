#!/usr/bin/env node
/**
 * UI sweep: visits every route for each role at several widths, opens common
 * menus / tabs / dialogs, and flags small visual bugs automatically.
 *
 * Usage:
 *   BASE=http://localhost:3311 SIDS='{"owner":"…","editor":"…","client":"…"}' \
 *   IDS='{"project":"…","client":"…","media":"…","invoice":"…"}' OUT=./ui-sweep-out \
 *   node scripts/ui-sweep.mjs
 * Optional: WIDTHS=1440,390  ROLES=owner  ONLY=/review  SHOTS=1  CHROME=/usr/bin/google-chrome
 * Writes OUT/report.json, OUT/report.md and (SHOTS=1) OUT/shots/*.png.
 */
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.env.BASE ?? "http://localhost:3311";
const SIDS = JSON.parse(process.env.SIDS ?? "{}");
const IDS = JSON.parse(process.env.IDS ?? "{}");
const OUT = process.env.OUT ?? "ui-sweep-out";
const WIDTHS = (process.env.WIDTHS ?? "1440,1024,768,390").split(",").map(Number);
const ROLES = (process.env.ROLES ?? "owner,editor,client,anon").split(",");
const ONLY = process.env.ONLY;
const SHOTS = process.env.SHOTS === "1";
const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src");

const p = (s) => s.replace("{project}", IDS.project ?? "").replace("{client}", IDS.client ?? "").replace("{media}", IDS.media ?? "").replace("{invoice}", IDS.invoice ?? "");
const TABS = ["Files", "Tasks", "Brief & Specs", "Activity Log", "Client uploads", "Pricing"];
const team = [
  "/", "/projects", "/projects?campaign={project}", ...TABS.map((t) => `/projects?campaign={project}#tab=${t}`),
  "/projects/archived", "/files", "/tasks", "/clients", "/clients?client={client}", "/clients/requests",
  "/review", "/review?media={media}", "/money", "/money/invoices/{invoice}", "/settings", "/team", "/chat",
  "/messages", "/notifications", "/deliverables", "/render-queue", "/help", "/onboarding", "/nope-404",
  "/platform", "/platform/users", "/platform/workspaces", "/platform/support", "/platform/jobs", "/platform/audit",
];
const ROUTES = {
  owner: team,
  editor: team.filter((r) => !r.startsWith("/money") && !r.startsWith("/platform")),
  client: ["/", "/portal/requests", "/portal/requests/new", "/portal/chat", "/projects", "/projects?campaign={project}", "/review", "/review?media={media}", "/files", "/settings", "/notifications", "/help"],
  anon: ["/sign-in", "/sign-up", "/forgot-password", "/reset-password", "/verify-email", "/invite", "/welcome", "/pricing", "/features", "/contact", "/privacy", "/terms", "/cookies"],
};
// Things to open after the page settles; each is re-checked once open.
const OPENERS = [
  { name: "menu", sel: "button[aria-haspopup]:visible, [aria-expanded=false]:visible" },
  { name: "dialog", sel: "button:has-text('New'):visible" },
];

// 404s that are the page's correct answer: the 404 route itself, /review with no media, staff-only pages.
const expected404 = (route, msg) => /status of 40[34]/.test(msg) && /^\/(nope-404|review$|review\?$|platform)/.test(route || "");

const OLD_GREYS = ["rgb(10, 10, 10)", "rgb(0, 0, 0)", "rgb(20, 20, 20)", "rgb(28, 28, 28)", "rgb(16, 16, 16)"];

/** Runs in the page. Returns raw findings. */
function detect({ oldGreys, small }) {
  const out = [];
  const vw = innerWidth;
  const sig = (el) => {
    const bits = [];
    for (let e = el, i = 0; e && e !== document.body && i < 3; e = e.parentElement, i++) {
      const cls = [...e.classList].filter((c) => !/^(css|_|sc-)/.test(c)).slice(0, 2).join(".");
      bits.unshift(e.tagName.toLowerCase() + (cls ? "." + cls : ""));
    }
    return bits.join(" > ");
  };
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const s = getComputedStyle(el);
    return s.visibility !== "hidden" && s.display !== "none" && +s.opacity > 0.01;
  };
  // Not hit-testable (invisible scrims, decorative layers): never an overlap or tap problem.
  const inert = (el) => getComputedStyle(el).pointerEvents === "none" || !!el.closest("[inert], [aria-hidden=true]");
  // A deliberate layer: popovers, menus, dialogs, drawers, fixed scrims.
  const layerOf = (el) => {
    for (let e = el; e && e !== document.body; e = e.parentElement) {
      if (e.matches(".ui-popover, [data-radix-popper-content-wrapper], [role=menu], [role=listbox], [role=dialog]")) return e;
      if (getComputedStyle(e).position === "fixed") return e;
    }
    return null;
  };
  const text = (el) => (el.innerText ?? el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 60);
  const all = [...document.querySelectorAll("body *")].filter((el) => !el.closest("svg") || el.tagName === "svg");
  const ctx = document.createElement("canvas").getContext("2d");

  for (const el of all) {
    if (!visible(el)) continue;
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const ownText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    // 1. clipped text
    if (el.tagName === "SELECT" || (el.tagName === "INPUT" && /^(text|search|email|)$/.test(el.type) && el.value)) {
      const label = el.tagName === "SELECT" ? el.selectedOptions[0]?.text ?? "" : el.value;
      ctx.font = `${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;
      const need = ctx.measureText(label).width;
      const room = el.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight);
      if (label && need > room + 1) out.push({ cat: "text-clipped", el: sig(el), text: label, info: `needs ${need.toFixed(0)}px, has ${room.toFixed(0)}px` });
    } else if (r.width <= 1 || r.height <= 1 || s.clip === "rect(0px, 0px, 0px, 0px)" || s.clipPath === "inset(50%)") {
      // visually-hidden (sr-only) text is meant to be clipped
    } else if (ownText && el.scrollWidth > el.clientWidth + 1 && s.overflowX !== "visible" && !/auto|scroll/.test(s.overflowX)) {
      out.push({ cat: s.textOverflow === "ellipsis" ? "text-ellipsis" : "text-clipped", el: sig(el), text: text(el), info: `${el.scrollWidth}>${el.clientWidth}` });
    }
    // start-of-label cut: text range starts left of its clipping box
    if (ownText && s.overflowX === "hidden") {
      const range = document.createRange(); range.selectNodeContents(el);
      const tr = range.getBoundingClientRect();
      if (tr.width && tr.left < r.left + parseFloat(s.borderLeftWidth) - 1) out.push({ cat: "text-clipped", el: sig(el), text: text(el), info: "start of label cut" });
    }
    // 2. horizontal viewport overflow
    if (r.right > vw + 1 && r.left < vw) {
      let clipped = false;
      for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
        const as = getComputedStyle(a);
        if (as.overflowX !== "visible" && a.getBoundingClientRect().right <= vw + 1) { clipped = true; break; }
        if (as.position === "fixed") break;
      }
      if (!clipped) out.push({ cat: "viewport-overflow", el: sig(el), text: text(el).slice(0, 30), info: `right=${r.right.toFixed(0)} vw=${vw}` });
    }
    // 4. leftover blacks / old greys
    if (oldGreys.includes(s.backgroundColor) && !el.querySelector(":scope > video, :scope > canvas, :scope > img") && !["VIDEO", "CANVAS", "IMG", "IFRAME"].includes(el.tagName)) {
      out.push({ cat: "old-background", el: sig(el), text: text(el).slice(0, 30), info: s.backgroundColor });
    }
    // 9. icons
    if (el.tagName === "svg" && el.closest("button, a")) {
      const host = el.closest("button, a"); const hr = host.getBoundingClientRect();
      if ((r.width < 2 || r.height < 2)) out.push({ cat: "icon-problem", el: sig(el), text: text(host), info: "zero-size icon" });
      else if (hr.height < 60 && getComputedStyle(host).display.includes("flex") && Math.abs((r.top + r.bottom) / 2 - (hr.top + hr.bottom) / 2) > 3) out.push({ cat: "icon-problem", el: sig(el), text: text(host), info: "icon off-centre" });
    }
    if (el.tagName === "IMG" && el.complete && el.naturalWidth === 0) out.push({ cat: "icon-problem", el: sig(el), text: el.alt, info: "broken image" });
  }
  if (document.scrollingElement.scrollWidth > vw + 1) out.push({ cat: "viewport-overflow", el: "document", text: "", info: `page scrollWidth ${document.scrollingElement.scrollWidth} > ${vw}` });

  // 3. overlapping interactive elements, 6. tap targets, 7. focus ring clipping
  const inter = [...document.querySelectorAll("a[href], button, input:not([type=hidden]), select, textarea, [role=button], [role=tab], [role=menuitem]")].filter((el) => visible(el) && !inert(el));
  const rects = inter.map((el) => el.getBoundingClientRect());
  for (let i = 0; i < inter.length; i++) {
    for (let j = i + 1; j < inter.length; j++) {
      if (inter[i].contains(inter[j]) || inter[j].contains(inter[i])) continue;
      const a = rects[i], b = rects[j];
      const w = Math.min(a.right, b.right) - Math.max(a.left, b.left), h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (w > 2 && h > 2 && w * h > 16) {
        const top = document.elementFromPoint(Math.max(a.left, b.left) + w / 2, Math.max(a.top, b.top) + h / 2);
        // One element sits in an open layer (menu, drawer, dialog) covering the page: intended.
        const la = layerOf(inter[i]), lb = layerOf(inter[j]);
        if (la !== lb) continue;
        if (top && (inter[i].contains(top) || inter[j].contains(top))) out.push({ cat: "overlap", el: sig(inter[i]) + " ⟂ " + sig(inter[j]), text: text(inter[i]).slice(0, 20) + " / " + text(inter[j]).slice(0, 20), info: `${w.toFixed(0)}x${h.toFixed(0)}` });
      }
    }
  }
  for (let i = 0; i < inter.length; i++) {
    const el = inter[i], r = rects[i];
    if (small && (r.width < 40 || r.height < 40) && !(el.tagName === "A" && el.closest("p, li > p")) && !["checkbox", "radio", "range"].includes(el.type)) {
      out.push({ cat: "tap-target", el: sig(el), text: text(el).slice(0, 30) || el.getAttribute("aria-label") || "", info: `${r.width.toFixed(0)}x${r.height.toFixed(0)}` });
    }
    // focus ring clipped by an overflow:hidden ancestor (ring size read from the real :focus-visible style)
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      const as = getComputedStyle(a);
      if (as.overflow === "visible" && as.overflowX === "visible") continue;
      const ar = a.getBoundingClientRect();
      let ring = 3;
      if (r.left - 3 < ar.left || r.right + 3 > ar.right || r.top - 3 < ar.top || r.bottom + 3 > ar.bottom) {
        const prev = document.activeElement;
        try { el.focus({ preventScroll: true, focusVisible: true }); } catch {}
        const fs = getComputedStyle(el);
        ring = fs.outlineStyle !== "none" ? parseFloat(fs.outlineWidth) + parseFloat(fs.outlineOffset) - 1 : (fs.boxShadow !== "none" ? 3 : 0);
        el.blur(); if (prev && prev !== document.body) try { prev.focus({ preventScroll: true }); } catch {}
      }
      if (ring > 0 && (r.left - ring < ar.left || r.right + ring > ar.right || r.top - ring < ar.top || r.bottom + ring > ar.bottom)) {
        if (r.right > ar.left && r.left < ar.right && r.bottom > ar.top && r.top < ar.bottom) out.push({ cat: "focus-clipped", el: sig(el), text: text(el).slice(0, 30), info: `clipped by ${sig(a).split(" > ").pop()}` });
      }
      break;
    }
  }
  // 5. native selects
  for (const el of document.querySelectorAll("select")) if (visible(el)) out.push({ cat: "native-select", el: sig(el), text: el.selectedOptions[0]?.text ?? "", info: el.getAttribute("aria-label") ?? "" });
  return out;
}

function staticScan() {
  const hits = [];
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((f) => {
    const fp = path.join(d, f.name);
    if (f.isDirectory()) return walk(fp);
    if (!/\.(css|tsx)$/.test(f.name) || /\.test\./.test(f.name)) return;
    fs.readFileSync(fp, "utf8").split("\n").forEach((line, i) => {
      const where = `${path.relative(SRC, fp)}:${i + 1}`;
      if (/#(0a0a0a|000000|000|141414|1c1c1c|101010)\b/i.test(line) && /background|bg-\[/i.test(line)) hits.push({ cat: "static-old-colour", where, line: line.trim().slice(0, 140) });
      if (/(?<!max-|min-)width:\s*\d{3,}px|\bw-\[\d{3,}px\]/.test(line)) hits.push({ cat: "static-fixed-width", where, line: line.trim().slice(0, 140) });
    });
  });
  walk(SRC);
  return hits;
}

let browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/usr/bin/google-chrome" });
fs.mkdirSync(path.join(OUT, "shots"), { recursive: true });
const findings = [];
const seen = new Set();
const add = (base, list) => list.forEach((f) => {
  const key = [f.cat, base.role, base.route, base.width, f.el, f.text].join("|");
  if (seen.has(key)) return; seen.add(key); findings.push({ ...base, ...f });
});

for (const role of ROLES) {
  for (const width of WIDTHS) {
    let ctx, page, current = "";
    const fresh = async () => {
      if (!browser.isConnected()) browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/usr/bin/google-chrome" });
      ctx = await browser.newContext({ viewport: { width, height: width < 500 ? 844 : 900 } });
      if (SIDS[role]) await ctx.addCookies([{ name: "sessionid", value: SIDS[role], url: BASE }]);
      page = await ctx.newPage();
      // a click that opens a new tab must not take the sweep with it
      ctx.on("page", (extra) => { if (extra !== page) extra.close().catch(() => {}); });
      page.on("console", (m) => { if (m.type() === "error" && !expected404(current, m.text())) add({ role, width, route: current, state: "load" }, [{ cat: "console-error", el: "", text: m.text().slice(0, 200), info: "" }]); });
    page.on("pageerror", (e) => add({ role, width, route: current, state: "load" }, [{ cat: "console-error", el: "", text: String(e.message).slice(0, 200), info: "pageerror" }]));
    };
    await fresh();
    for (const raw of ROUTES[role] ?? []) {
     if (page.isClosed() || !browser.isConnected()) await fresh();
     try {
      const [route, hash] = p(raw).split("#tab=");
      const label = hash ? `${route} [${hash}]` : route;
      if (ONLY && !label.includes(ONLY)) continue;
      current = label;
      await page.goto(BASE + route, { waitUntil: "load", timeout: 20000 }).catch(() => {});
      await page.waitForLoadState("networkidle", { timeout: 2500 }).catch(() => {});
      await page.waitForTimeout(600);
      if (hash) await page.getByRole("tab", { name: hash, exact: true }).first().click({ timeout: 3000 }).then(() => page.waitForTimeout(900)).catch(() => {});
      const args = { oldGreys: OLD_GREYS, small: width < 500 };
      add({ role, width, route: label, state: "load" }, await page.evaluate(detect, args).catch(() => []));
      const slug = `${role}-${width}-${label.replace(/[^a-z0-9]+/gi, "_").slice(0, 60)}`;
      if (SHOTS) await page.screenshot({ path: path.join(OUT, "shots", slug + ".png") }).catch(() => {});
      // open a few menus / dialogs and re-check
      for (const op of OPENERS) {
        const handles = await page.locator(op.sel).all().catch(() => []);
        for (const h of handles.slice(0, 2)) {
          const name = ((await h.getAttribute("aria-label").catch(() => null)) ?? (await h.innerText().catch(() => ""))).trim().slice(0, 30);
          if (/sign out|log ?out|delete|remove|archive/i.test(name)) continue;
          const ok = await h.click({ timeout: 1500 }).then(() => true).catch(() => false);
          if (!ok) continue;
          await page.waitForTimeout(400);
          if (page.url().replace(/#.*/, "") !== BASE + route && !page.url().startsWith(BASE + route)) { await page.goBack().catch(() => {}); await page.waitForTimeout(500); continue; }
          add({ role, width, route: label, state: `${op.name}:${name}` }, await page.evaluate(detect, args).catch(() => []));
          if (SHOTS) await page.screenshot({ path: path.join(OUT, "shots", `${slug}--${op.name}-${name.replace(/[^a-z0-9]+/gi, "_")}.png`) }).catch(() => {});
          await page.keyboard.press("Escape").catch(() => {});
          await page.waitForTimeout(250);
        }
      }
     } catch (error) { console.error(`route ${raw} failed: ${error.message}`); }
    }
    await ctx.close().catch(() => {});
  }
}
await browser.close();

const statics = staticScan();
const totals = {};
for (const f of [...findings, ...statics]) totals[f.cat] = (totals[f.cat] ?? 0) + 1;
fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify({ when: new Date().toISOString(), base: BASE, widths: WIDTHS, roles: ROLES, totals, findings, statics }, null, 1));
const md = [`# UI sweep — ${new Date().toISOString()}`, "", "| category | count |", "|---|---|", ...Object.entries(totals).sort().map(([k, v]) => `| ${k} | ${v} |`), ""];
const byCat = {};
for (const f of findings) (byCat[f.cat] ??= []).push(f);
for (const [cat, list] of Object.entries(byCat).sort()) {
  md.push(`## ${cat} (${list.length})`, "");
  for (const f of list.slice(0, 400)) md.push(`- \`${f.role}@${f.width}\` ${f.route} (${f.state}) — \`${f.el}\` “${f.text}” ${f.info}`);
  md.push("");
}
md.push(`## static scan (${statics.length})`, "", ...statics.map((s) => `- ${s.cat} \`${s.where}\` ${s.line}`));
fs.writeFileSync(path.join(OUT, "report.md"), md.join("\n"));
console.log(JSON.stringify(totals, null, 1));
