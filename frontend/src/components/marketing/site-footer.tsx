import Link from "next/link";
import { siteConfig } from "@/lib/site-config";
import { Brand } from "./site-header";

const COLUMNS = [
  { title: "Product", links: [{ href: "/features", label: "Features" }, { href: "/pricing", label: "Pricing" }, { href: siteConfig.links.signUp, label: "Start free trial" }, { href: siteConfig.links.signIn, label: "Log in" }] },
  { title: "Company", links: [{ href: "/contact", label: "Contact" }, { href: `mailto:${siteConfig.contactEmail}`, label: "Email us" }] },
  { title: "Legal", links: [{ href: "/privacy", label: "Privacy" }, { href: "/terms", label: "Terms" }, { href: "/cookies", label: "Cookies" }] },
];

export function SiteFooter() {
  return (
    <footer className="mk-footer">
      <div className="mk-wrap">
        <div className="mk-footer-grid">
          <div className="mk-footer-about">
            <Brand />
            <p>{siteConfig.tagline}</p>
          </div>
          {COLUMNS.map((column) => (
            <nav key={column.title} aria-labelledby={`mk-footer-${column.title}`}>
              <h2 id={`mk-footer-${column.title}`}>{column.title}</h2>
              <ul>
                {column.links.map((link) => <li key={link.href}><Link href={link.href}>{link.label}</Link></li>)}
              </ul>
            </nav>
          ))}
        </div>
        <div className="mk-footer-base">
          <span>© {new Date().getFullYear()} {siteConfig.name}. All rights reserved.</span>
          <a href={`mailto:${siteConfig.contactEmail}`}>{siteConfig.contactEmail}</a>
        </div>
      </div>
    </footer>
  );
}
