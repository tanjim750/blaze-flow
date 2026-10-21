import Link from "next/link";
import { siteConfig } from "@/lib/site-config";
import { ProBrand } from "./pro-header";

const COLUMNS = [
  { title: "Product", links: [{ href: "/features", label: "Features" }, { href: "/pricing", label: "Pricing" }, { href: siteConfig.links.signUp, label: "Start free trial" }, { href: siteConfig.links.signIn, label: "Log in" }] },
  { title: "Company", links: [{ href: "/contact", label: "Contact" }, { href: `mailto:${siteConfig.contactEmail}`, label: "Email us" }] },
  { title: "Legal", links: [{ href: "/privacy", label: "Privacy" }, { href: "/terms", label: "Terms" }, { href: "/cookies", label: "Cookies" }] },
];

export function ProFooter() {
  return (
    <footer className="pro-footer">
      <div className="pro-wrap">
        <div className="pro-footer-grid">
          <div className="pro-footer-about">
            <ProBrand />
            <p>{siteConfig.tagline}</p>
          </div>
          {COLUMNS.map((column) => (
            <nav key={column.title} aria-labelledby={`pro-footer-${column.title}`}>
              <h2 id={`pro-footer-${column.title}`}>{column.title}</h2>
              <ul>{column.links.map((link) => <li key={link.href}><Link href={link.href}>{link.label}</Link></li>)}</ul>
            </nav>
          ))}
        </div>
        <div className="pro-footer-base">
          <span>© {new Date().getFullYear()} {siteConfig.name}</span>
          <a href={`mailto:${siteConfig.contactEmail}`}>{siteConfig.contactEmail}</a>
        </div>
      </div>
    </footer>
  );
}
