import Link from "next/link";
import { Compass, House, FolderKanban } from "@/components/icons";
import "./not-found.css";

/** The branded 404: says what happened and offers a way back. Used inside and outside the app shell. */
export function NotFoundPanel({ standalone = false }: { standalone?: boolean }) {
  return (
    <section className={`nf ${standalone ? "is-standalone" : ""}`} aria-labelledby="nf-title">
      <div className="nf-card">
        <span className="nf-badge" aria-hidden="true"><Compass /></span>
        <p className="nf-code">404</p>
        <h1 id="nf-title">This page doesn’t exist</h1>
        <p className="nf-copy">The link may be old, or the page was moved or deleted. Check the address, or head back to somewhere familiar.</p>
        <div className="nf-actions">
          <Link className="nf-primary" href="/"><House aria-hidden="true" />Back to home</Link>
          <Link className="nf-secondary" href="/projects"><FolderKanban aria-hidden="true" />Projects</Link>
        </div>
      </div>
    </section>
  );
}
