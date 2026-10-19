"use client";

import { useState, type FormEvent } from "react";
import { Send } from "lucide-react";
import { siteConfig } from "@/lib/site-config";

/**
 * Contact form without a backend: it composes an email in the visitor's own mail app
 * (`mailto:`), so nothing is stored or sent by us until they press send there.
 */
export function buildMailto(fields: { name: string; email: string; company: string; topic: string; message: string }): string {
  const subject = `${fields.topic} · ${siteConfig.name} website`;
  const body = [fields.message, "", "—", `Name: ${fields.name}`, `Email: ${fields.email}`, fields.company && `Company: ${fields.company}`].filter((line) => line !== "").join("\n");
  return `mailto:${siteConfig.contactEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export function ContactForm() {
  const [opened, setOpened] = useState(false);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const get = (key: string) => String(data.get(key) ?? "").trim();
    window.location.href = buildMailto({ name: get("name"), email: get("email"), company: get("company"), topic: get("topic"), message: get("message") });
    setOpened(true);
  };
  return (
    <form className="mk-form" onSubmit={submit} aria-labelledby="mk-contact-form-title">
      <h2 id="mk-contact-form-title">Send us a message</h2>
      <div className="mk-form-row">
        <label>Your name<input name="name" autoComplete="name" required /></label>
        <label>Work email<input name="email" type="email" autoComplete="email" required /></label>
      </div>
      <div className="mk-form-row">
        <label><span>Company <span className="mk-muted">(optional)</span></span><input name="company" autoComplete="organization" /></label>
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
      <label>Message<textarea name="message" required /></label>
      <button type="submit" className="mk-btn"><Send aria-hidden="true" />Open in my email app</button>
      <p className="mk-fineprint" role="status">
        {opened
          ? <>Your email app should have opened. If not, write to <a href={`mailto:${siteConfig.contactEmail}`}>{siteConfig.contactEmail}</a>.</>
          : <>This opens a pre-filled email to {siteConfig.contactEmail}; nothing is sent until you press send. See our <a href="/privacy">privacy notice</a>.</>}
      </p>
    </form>
  );
}
