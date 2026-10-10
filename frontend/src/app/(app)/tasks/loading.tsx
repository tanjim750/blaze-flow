import "./tasks.css";

const CARDS = [3, 2, 2, 1, 1, 2];

/** Board-shaped placeholder: header, filter row and six stage columns. */
export default function Loading() {
  return <div className="tb-root tb-skeleton" aria-busy="true" aria-label="Loading tasks">
    <header className="tb-head"><div className="tb-title"><span className="tb-bone is-title" /><span className="tb-bone is-line" /></div></header>
    <div className="tb-filter-row"><span className="tb-bone is-search" /><span className="tb-bone is-chip" /><span className="tb-bone is-chip" /><span className="tb-bone is-chip" /></div>
    <div className="tb-board">{CARDS.map((count, column) => <section key={column} className="tb-column">
      <header className="tb-column-head"><span className="tb-bone is-label" /></header>
      <div className="tb-column-body">{Array.from({ length: count }, (_, card) => <span key={card} className="tb-bone is-card" />)}</div>
    </section>)}</div>
  </div>;
}
