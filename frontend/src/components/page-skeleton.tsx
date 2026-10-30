/**
 * Placeholder for a page body that is still loading.
 *
 * The sidebar and topbar live in the route group's layout, so they stay on screen and keep
 * working during a navigation. Only the body is replaced by this.
 */
export function PageSkeleton({ shape = "list" }: { shape?: "list" | "grid" | "board" | "split" }) {
  return (
    <div className="sk-body" aria-hidden="true">
      <div className="sk-head"><span className="sk sk-line sk-title" /><span className="sk sk-pill sk-w-140" /></div>
      <Body shape={shape} />
    </div>
  );
}

function Body({ shape }: { shape: "list" | "grid" | "board" | "split" }) {
  if (shape === "board") {
    return (
      <div className="sk-board">
        {Array.from({ length: 5 }, (_, column) => (
          <div className="sk-column" key={column}>
            <span className="sk sk-line sk-w-60" />
            {Array.from({ length: 3 - (column % 2) }, (_, card) => <span className="sk sk-card" key={card} />)}
          </div>
        ))}
      </div>
    );
  }
  if (shape === "grid") {
    return <div className="sk-grid">{Array.from({ length: 8 }, (_, index) => <span className="sk sk-tile" key={index} />)}</div>;
  }
  if (shape === "split") {
    return <div className="sk-split"><span className="sk sk-panel" /><span className="sk sk-panel sk-panel-side" /></div>;
  }
  return <div className="sk-list">{Array.from({ length: 6 }, (_, index) => <span className="sk sk-bar" key={index} />)}</div>;
}
