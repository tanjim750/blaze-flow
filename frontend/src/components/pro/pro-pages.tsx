"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { motion } from "motion/react";
import { Check, Send, TriangleAlert } from "lucide-react";
import type { ScreenKey } from "@/components/marketing/screenshot";
import { siteConfig } from "@/lib/site-config";
import { cn } from "@/lib/utils";
import { Reveal, Shot, useSettle } from "./pro-home";

/*
 * Building blocks for the inner public pages (features, pricing, contact, legal). They use
 * the homepage's motion system, so the reduced-motion and phone fallbacks come along.
 */

/** Short page opener: label, h1, one line. */
export function ProPageHero({ label, title, line }: { label: string; title: ReactNode; line?: ReactNode }) {
  return (
    <section className="pro-page-hero">
      <div className="pro-wrap">
        <Reveal y={40}><p className="pro-label">{label}</p></Reveal>
        <Reveal y={48} delay={0.08}><h1 className="pro-h1 is-page">{title}</h1></Reveal>
        {line && <Reveal y={40} delay={0.16}><p className="pro-sub">{line}</p></Reveal>}
      </div>
    </section>
  );
}

/** A real app screenshot that tilts flat as it scrolls into view. */
export function ProSettleShot({ name, from = -22, sizes = "(max-width: 960px) 92vw, 720px" }: { name: ScreenKey; from?: number; sizes?: string }) {
  const { ref, style } = useSettle(from);
  return (
    <div className="pro-persp" ref={ref}>
      <motion.div className="pro-window" style={style}><Shot name={name} sizes={sizes} /></motion.div>
    </div>
  );
}

/** One feature: copy beside a settling screenshot. `flip` puts the picture on the left. */
export function ProFeatureRow({ id, label, title, line, points, shot, flip = false }: { id: string; label: string; title: string; line: string; points: string[]; shot: ScreenKey; flip?: boolean }) {
  return (
    <section className={cn("pro-feature", flip && "is-alt")} id={id} aria-labelledby={`${id}-title`}>
      <div className={cn("pro-wrap pro-feature-grid", flip && "is-flip")}>
        <Reveal className="pro-feature-copy">
          <p className="pro-label">{label}</p>
          <h2 id={`${id}-title`} className="pro-h2">{title}</h2>
          <p className="pro-line">{line}</p>
          <ul className="pro-points">{points.map((p) => <li key={p}><Check aria-hidden="true" />{p}</li>)}</ul>
        </Reveal>
        <ProSettleShot name={shot} from={flip ? 22 : -22} />
      </div>
    </section>
  );
}

/** A grid of small cards that lift on hover and enter with a stagger. */
export function ProCardGrid({ items, headingLevel = "h3" }: { items: { title: string; line: ReactNode; icon?: ReactNode }[]; headingLevel?: "h2" | "h3" }) {
  const H = headingLevel;
  return (
    <div className="pro-cards">
      {items.map((item, i) => (
        <Reveal key={item.title} delay={(i % 3) * 0.1} tilt={14} className="pro-card">
          {item.icon && <span className="pro-card-icon" aria-hidden="true">{item.icon}</span>}
          <H>{item.title}</H>
          <p>{item.line}</p>
        </Reveal>
      ))}
    </div>
  );
}

/** Last edit to the starter legal text. Update when the owner revises any legal page. */
export const LEGAL_UPDATED = "18 October 2026";

/** Privacy, terms and cookies. Each opens with the draft / not-legal-advice banner. */
export function ProLegal({ title, intro, children }: { title: string; intro: ReactNode; children: ReactNode }) {
  return (
    <>
      <ProPageHero label="Legal" title={title} line={intro} />
      <section className="pro-legal">
        <div className="pro-wrap pro-legal-col">
          <div className="pro-draft-banner" role="note" data-testid="legal-draft-banner">
            <TriangleAlert aria-hidden="true" />
            <p><b>Draft for review.</b> This is starter text that the owner of {siteConfig.name} must review and adapt before relying on it. It is not legal advice. Where details are marked “to be confirmed”, they still need filling in.</p>
          </div>
          <div className="pro-prose">
            <p><em>Last updated: {LEGAL_UPDATED}</em></p>
            {children}
          </div>
        </div>
      </section>
    </>
  );
}

/**
 * Contact form without a backend: it composes an email in the visitor's own mail app
 * (`mailto:`), so nothing is stored or sent by us until they press send there.
 */
export function buildMailto(fields: { name: string; email: string; company: string; topic: string; message: string }): string {
  const subject = `${fields.topic} · ${siteConfig.name} website`;
  const body = [fields.message, "", "—", `Name: ${fields.name}`, `Email: ${fields.email}`, fields.company && `Company: ${fields.company}`].filter((line) => line !== "").join("\n");
  return `mailto:${siteConfig.contactEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export function ProContactForm() {
  const [opened, setOpened] = useState(false);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const get = (key: string) => String(data.get(key) ?? "").trim();
    window.location.href = buildMailto({ name: get("name"), email: get("email"), company: get("company"), topic: get("topic"), message: get("message") });
    setOpened(true);
  };
  return (
    <form className="pro-form" onSubmit={submit} aria-labelledby="pro-contact-form-title">
      <h2 id="pro-contact-form-title" className="pro-form-title">Send a message</h2>
      <div className="pro-form-row">
        <label>Your name<input name="name" autoComplete="name" required /></label>
        <label>Work email<input name="email" type="email" autoComplete="email" required /></label>
      </div>
      <div className="pro-form-row">
        <label><span>Company <span className="pro-muted">(optional)</span></span><input name="company" autoComplete="organization" /></label>
        <label>Topic
          <select name="topic" defaultValue="Question">
            <option>Question</option>
            <option>Demo request</option>
            <option>Pricing</option>
            <option>Support</option>
            <option>Privacy request</option>
          </select>
        </label>
      </div>
      <label>Message<textarea name="message" required rows={5} /></label>
      <button type="submit" className="pro-btn"><Send aria-hidden="true" />Open in my email app</button>
      <p className="pro-fine" role="status">
        {opened
          ? <>Your email app should have opened. If not, write to <a href={`mailto:${siteConfig.contactEmail}`}>{siteConfig.contactEmail}</a>.</>
          : <>This opens a pre-filled email to {siteConfig.contactEmail}. Nothing is sent until you press send. See the <a href="/privacy">privacy notice</a>.</>}
      </p>
    </form>
  );
}
