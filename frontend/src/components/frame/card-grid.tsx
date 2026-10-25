"use client";

/**
 * A Frame-style grid of media cards for read-mostly places (the client portal's project
 * files). Same primitives as the studio library — HoverMedia, SelectionBar, thick
 * selection outline — so a client sees the same browser the studio does.
 * Click selects (Cmd/Ctrl/Shift add), double-click or Enter opens, a tap on touch opens.
 */
import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Clapperboard } from "lucide-react";
import { toast } from "sonner";
import { copyText, HoverMedia, SelectionBar } from "./frame-ui";

export type CardItem = {
  id: string; title: string; subtitle?: string; badge?: ReactNode;
  poster: string | null; openHref: string; downloadHref?: string | null; isVideo?: boolean;
  /** Extra actions under the caption (rendered by the server page, e.g. "Discuss"). */
  actions?: ReactNode;
};

export function CardGrid({ items, label }: { items: CardItem[]; label: string }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const picked = items.filter((item) => selected.has(item.id));
  const toggle = (id: string, additive: boolean) => setSelected((prev) => {
    const next = new Set(additive ? prev : []);
    if (additive && prev.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  return (
    <>
      <ul className="frm-cards" role="list" aria-label={label}>
        {items.map((item) => (
          <li key={item.id} className={`frm-card ${selected.has(item.id) ? "is-selected" : ""}`}>
            <div
              role="button" tabIndex={0} aria-pressed={selected.has(item.id)} aria-label={`${item.title}${item.subtitle ? `, ${item.subtitle}` : ""}`}
              className="frm-card-frame"
              onPointerUp={(event) => { if (event.pointerType === "touch") router.push(item.openHref); }}
              onClick={(event) => { if ((event.nativeEvent as PointerEvent).pointerType === "touch") return; toggle(item.id, event.metaKey || event.ctrlKey || event.shiftKey); }}
              onDoubleClick={() => router.push(item.openHref)}
              onKeyDown={(event) => { if (event.key === "Enter") router.push(item.openHref); if (event.key === " ") { event.preventDefault(); toggle(item.id, true); } if (event.key === "Escape") setSelected(new Set()); }}
            >
              <HoverMedia isVideo={item.isVideo ?? true} videoSrc={item.downloadHref ?? null}
                // eslint-disable-next-line @next/next/no-img-element -- auth-proxied same-origin posters
                poster={item.poster ? <img src={item.poster} alt="" loading="lazy" draggable={false} /> : <span className="frm-card-glyph"><Clapperboard aria-hidden="true" /></span>} />
            </div>
            <div className="frm-card-caption">
              <strong title={item.title}>{item.title}</strong>
              {item.subtitle && <small>{item.subtitle}</small>}
              {item.badge}
            </div>
            {item.actions && <div className="frm-card-actions">{item.actions}</div>}
          </li>
        ))}
      </ul>
      <SelectionBar
        count={picked.length}
        onClear={() => setSelected(new Set())}
        onCopyLink={async () => { const ok = await copyText(picked.map((item) => `${window.location.origin}${item.openHref}`).join("\n")); toast[ok ? "success" : "error"](ok ? (picked.length === 1 ? "Link copied" : `${picked.length} links copied`) : "Could not copy"); }}
        onDownload={() => picked.forEach((item, index) => { if (item.downloadHref) window.setTimeout(() => { const a = document.createElement("a"); a.href = item.downloadHref!; a.download = ""; document.body.appendChild(a); a.click(); a.remove(); }, index * 250); })}
        downloadDisabled={!picked.some((item) => item.downloadHref)}
        more={picked.length === 1 ? <button type="button" className="frm-selbar-btn" onClick={() => router.push(picked[0].openHref)}><Clapperboard /><span>Open</span></button> : null}
      />
    </>
  );
}
