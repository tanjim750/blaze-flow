"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity, ArrowUpRight, CircleCheckBig, Download, Film, FolderInput, Link2, ListTodo, Loader2, MessageSquareText, RotateCcw, TriangleAlert,
} from "lucide-react";
import {
  ACTIVITY_FILTERS, activityText, clockTime, describeActivity, groupByDay, mergePages,
  type ActivityCategory, type ActivityEntry, type ActivityPage,
} from "@/lib/activity";
import "./activity-feed.css";

const PAGE_SIZE = 20;

/** The small badge on the avatar: what kind of thing happened. */
function kindIcon(entry: ActivityEntry) {
  const props = { size: 9, strokeWidth: 2.5 };
  if (entry.detail.decision === "approved" && entry.category === "media") return <CircleCheckBig {...props} />;
  if (entry.action === "media.revision.requested" || entry.action === "review.decision.changes_requested") return <RotateCcw {...props} />;
  switch (entry.category) {
    case "tasks": return <ListTodo {...props} />;
    case "comments": return <MessageSquareText {...props} />;
    case "media": return <Film {...props} />;
    case "guests": return <Link2 {...props} />;
    case "uploads": return <FolderInput {...props} />;
    default: return <Activity {...props} />;
  }
}

function Avatar({ entry }: { entry: ActivityEntry }) {
  const [broken, setBroken] = useState(false);
  return (
    <span className={`af-avatar is-${entry.actor.type}`} aria-hidden="true">
      {entry.actor.avatar_url && !broken
        // eslint-disable-next-line @next/next/no-img-element -- user-supplied avatar URL on any origin
        ? <img src={entry.actor.avatar_url} alt="" onError={() => setBroken(true)} />
        : <b>{entry.actor.initials || "?"}</b>}
      <i className={`af-kind is-${entry.category ?? "other"}`}>{kindIcon(entry)}</i>
    </span>
  );
}

function Sentence({ entry }: { entry: ActivityEntry }) {
  const line = describeActivity(entry);
  return (
    <p className="af-line">
      <strong>{line.actor}</strong>
      {entry.actor.type === "guest" && <span className="af-tag">Guest</span>}
      {entry.actor.type === "client" && <span className="af-tag">Client</span>}
      {" "}{line.verb}
      {line.subject && <> <q>{line.subject}</q></>}
      {line.tail && <> {line.tail}</>}
      {line.change && <> from <span className="af-stage">{line.change.from}</span> <span aria-label="to">→</span> <span className="af-stage is-to">{line.change.to}</span></>}
      {line.meta.map((part) => <span key={part} className="af-meta"> · {part}</span>)}
    </p>
  );
}

function Row({ entry, showProject }: { entry: ActivityEntry; showProject: boolean }) {
  const body = (
    <>
      <Avatar entry={entry} />
      <div className="af-body">
        <Sentence entry={entry} />
        {entry.detail.excerpt && <blockquote className="af-excerpt">{entry.detail.excerpt}</blockquote>}
        <small className="af-sub">
          <time dateTime={entry.created_at}>{clockTime(entry.created_at)}</time>
          {showProject && entry.project && <span> · {entry.project.name}</span>}
          {entry.team_only && <span className="af-team">Team only</span>}
        </small>
      </div>
      {entry.object?.href && <ArrowUpRight className="af-go" size={14} aria-hidden="true" />}
    </>
  );
  const label = activityText(describeActivity(entry));
  return (
    <li>
      {entry.object?.href
        ? <Link className="af-row is-link" href={entry.object.href} title={label}>{body}</Link>
        : <div className="af-row">{body}</div>}
    </li>
  );
}

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; entries: ActivityEntry[]; count: number; page: number; hasNext: boolean; canExport: boolean; more: "idle" | "loading" | "error" };

/**
 * A day-grouped timeline of what happened, read from the activity API.
 *
 * With `projectId` it is one project's Activity tab; without, the workspace. The API has
 * already removed what the viewer may not see (team notes for client members, internal
 * tasks, guest-link events without the manage permission), so this only renders.
 */
export function ActivityFeed({ workspaceId, projectId, showProject = !projectId }: { workspaceId: string; projectId?: string; showProject?: boolean }) {
  const [type, setType] = useState<ActivityCategory | null>(null);
  const [state, setState] = useState<State>({ status: "loading" });
  const [reload, setReload] = useState(0);
  const controller = useRef<AbortController | null>(null);
  const base = projectId ? `/api/workspaces/${workspaceId}/projects/${projectId}/activity/` : `/api/workspaces/${workspaceId}/activity/`;

  const fetchPage = useCallback(async (page: number, signal: AbortSignal): Promise<ActivityPage> => {
    const query = new URLSearchParams({ page: String(page), page_size: String(PAGE_SIZE) });
    if (type) query.set("type", type);
    const response = await fetch(`${base}?${query.toString()}`, { headers: { Accept: "application/json" }, credentials: "same-origin", signal });
    if (!response.ok) throw new Error(response.status === 403 ? "You don’t have access to this activity." : `The activity couldn’t be loaded (${response.status}).`);
    return await response.json() as ActivityPage;
  }, [base, type]);

  useEffect(() => {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    fetchPage(1, current.signal).then(
      (page) => setState({ status: "ready", entries: page.results, count: page.count, page: 1, hasNext: page.has_next, canExport: page.can_export, more: "idle" }),
      (error: unknown) => { if (!current.signal.aborted) setState({ status: "error", message: error instanceof Error ? error.message : "The activity couldn’t be loaded." }); },
    );
    return () => current.abort();
  }, [fetchPage, reload]);

  const loadMore = async () => {
    if (state.status !== "ready" || !state.hasNext || state.more === "loading") return;
    const signal = controller.current?.signal ?? new AbortController().signal;
    setState({ ...state, more: "loading" });
    try {
      const page = await fetchPage(state.page + 1, signal);
      setState((previous) => previous.status !== "ready" ? previous : {
        ...previous, entries: mergePages(previous.entries, page.results), count: page.count,
        page: previous.page + 1, hasNext: page.has_next, more: "idle",
      });
    } catch {
      if (!signal.aborted) setState((previous) => previous.status === "ready" ? { ...previous, more: "error" } : previous);
    }
  };

  const days = useMemo(() => (state.status === "ready" ? groupByDay(state.entries) : []), [state]);
  const exportHref = `${base}export/${type ? `?type=${type}` : ""}`;

  return (
    <section className="af" aria-label="Activity">
      <header className="af-head">
        <div className="af-filters" role="radiogroup" aria-label="Show">
          {ACTIVITY_FILTERS.map((filter) => (
            <button
              key={filter.label} type="button" role="radio" aria-checked={type === filter.value}
              onClick={() => { if (type === filter.value) return; setState({ status: "loading" }); setType(filter.value); }}
            >
              {filter.label}
            </button>
          ))}
        </div>
        {state.status === "ready" && state.canExport && (
          <a className="af-export" href={exportHref} download><Download size={14} />Export CSV</a>
        )}
      </header>

      {state.status === "loading" && (
        <ol className="af-skeleton" aria-label="Loading activity">
          {[0, 1, 2, 3].map((index) => <li key={index}><span /><div><i /><i /></div></li>)}
        </ol>
      )}

      {state.status === "error" && (
        <div className="af-empty" role="alert">
          <TriangleAlert size={22} aria-hidden="true" />
          <h2>Activity couldn’t be loaded</h2>
          <p>{state.message}</p>
          <button type="button" className="af-button" onClick={() => { setState({ status: "loading" }); setReload((value) => value + 1); }}><RotateCcw size={14} />Retry</button>
        </div>
      )}

      {state.status === "ready" && state.entries.length === 0 && (
        <div className="af-empty" role="status">
          <Activity size={22} aria-hidden="true" />
          <h2>{type ? "Nothing of this kind yet" : "No activity yet"}</h2>
          <p>Uploads, review notes, approvals, task moves and client link visits will appear here as they happen.</p>
        </div>
      )}

      {state.status === "ready" && days.length > 0 && (
        <>
          <ol className="af-days">
            {days.map((day) => (
              <li key={day.key} className="af-day">
                <h3><span>{day.label}</span><small>{day.entries.length} {day.entries.length === 1 ? "event" : "events"}</small></h3>
                <ol className="af-rows">
                  {day.entries.map((entry) => <Row key={entry.id} entry={entry} showProject={showProject} />)}
                </ol>
              </li>
            ))}
          </ol>
          <footer className="af-foot">
            <small>Showing {state.entries.length} of {state.count}</small>
            {state.hasNext && (
              <button type="button" className="af-button" onClick={loadMore} disabled={state.more === "loading"}>
                {state.more === "loading" ? <><Loader2 size={14} className="af-spin" />Loading…</> : "Load more"}
              </button>
            )}
            {state.more === "error" && <small className="af-error" role="alert">Couldn’t load more. Try again.</small>}
          </footer>
        </>
      )}
    </section>
  );
}
