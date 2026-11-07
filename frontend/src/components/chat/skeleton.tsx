import { Lock, MessagesSquare, Search, Users } from "@/components/icons";

/**
 * Chat placeholders in the exact shape of the real layout, so the shell never goes blank and
 * nothing jumps when the data lands. The static chrome (titles, search, tabs, composer frame)
 * paints immediately; the grey shapes fade in only after ~150ms, so fast loads show nothing.
 */
const BUBBLES = [62, 38, 74, 46, 55];

export function MessagesSkeleton({ composer = true }: { composer?: boolean }) {
  return <>
    <div className="mt-list ch-sk" aria-busy="true" aria-label="Loading messages">
      <div className="ch-sk-msgs">
        {BUBBLES.map((width, index) => <div className={`ch-sk-msg${index % 2 ? " is-short" : ""}`} key={index}>
          <span className="sk ch-sk-avatar" />
          <span className="ch-sk-lines">
            <span className="sk ch-sk-name" />
            <span className="sk ch-sk-bubble" style={{ width: `${width}%` }} />
          </span>
        </div>)}
      </div>
    </div>
    {composer && <div className="mt-composer ch-sk" aria-hidden="true"><span className="sk ch-sk-input" /></div>}
  </>;
}

export function ChatShellSkeleton({ withThread = false, variant = "studio" }: { withThread?: boolean; variant?: "studio" | "portal" }) {
  return <div className={`ch-shell is-${variant} sk-body ch-sk-shell`} aria-busy="true">
    <aside className={`ch-sidebar${withThread ? " is-hidden-mobile" : ""}`} aria-label="Channels">
      <header className="ch-side-head"><h1><MessagesSquare aria-hidden="true" />Chat</h1></header>
      <label className="ch-search"><Search aria-hidden="true" /><input disabled placeholder="Search or jump (⌘K)" aria-label="Search messages or jump to a channel" /></label>
      <div className="ch-views" aria-hidden="true"><button type="button" className="is-on" tabIndex={-1}>All</button><button type="button" tabIndex={-1}>Unreads</button><button type="button" tabIndex={-1}>Mentions</button></div>
      <nav className="ch-nav ch-sk" aria-hidden="true">
        {[0, 1].map((section) => <div className="ch-section" key={section}>
          <span className="sk ch-sk-section" />
          {[70, 52, 64].slice(0, 3 - section).map((width, index) => <span className="ch-sk-row" key={index}><span className="sk ch-sk-hash" /><span className="sk ch-sk-label" style={{ width: `${width}%` }} /></span>)}
        </div>)}
      </nav>
    </aside>
    <section className={`ch-main${withThread ? " is-open-mobile" : ""}`} aria-label="Conversation">
      <header className="ch-main-head ch-sk"><span className="sk ch-sk-title" /></header>
      <div className="ch-thread">
        <section className="mt-thread is-studio" aria-label="Project messages">
          <div className="mt-channels" aria-hidden="true">
            <span className="mt-channel is-on"><Users aria-hidden="true" /><span>With client</span></span>
            <span className="mt-channel is-team"><Lock aria-hidden="true" /><span>Team only</span></span>
          </div>
          <MessagesSkeleton />
        </section>
      </div>
    </section>
  </div>;
}
