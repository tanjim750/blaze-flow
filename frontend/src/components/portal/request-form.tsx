"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, Minus, Plus, Send, TriangleAlert } from "lucide-react";
import {
  ASPECT_OPTIONS, BUDGET_OPTIONS, DELIVERABLE_OPTIONS, LENGTH_OPTIONS, PLATFORM_OPTIONS, budgetLabel, dayDate,
  deliverablesSummary, requestProblems, submitProjectRequest, type DeliverableKind, type ProjectRequestInput,
} from "@/lib/portal";

type Picks = Partial<Record<DeliverableKind, number>>;

/**
 * "Start a new project": a short, three-step brief a client sends the studio. Our own
 * wording and layout; the studio answers from Clients → Project requests.
 */
export function ProjectRequestForm({ workspaceId, studioName, clientTeams, today }: {
  workspaceId: string; studioName: string; clientTeams: { id: string; name: string }[]; today: string;
}) {
  const router = useRouter();
  const [teamId, setTeamId] = useState(clientTeams[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [picks, setPicks] = useState<Picks>({});
  const [platform, setPlatform] = useState<string | null>(null);
  const [aspect, setAspect] = useState<string | null>(null);
  const [length, setLength] = useState<number | null>(null);
  const [brief, setBrief] = useState("");
  const [references, setReferences] = useState("");
  const [wantedBy, setWantedBy] = useState("");
  const [budget, setBudget] = useState("");
  const [tried, setTried] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  const deliverables = (Object.entries(picks) as [DeliverableKind, number][]).filter(([, qty]) => qty > 0).map(([kind, quantity]) => ({ kind, quantity }));
  const input: ProjectRequestInput = {
    client_team_id: teamId || undefined, title, deliverables, platform, aspect_ratio: aspect, target_length_seconds: length,
    brief, references, wanted_by: wantedBy || null, budget_range: budget,
  };
  const problems = requestProblems(input, today);
  const show = (field: keyof typeof problems) => (tried ? problems[field] : undefined);

  const toggle = (kind: DeliverableKind) => setPicks((current) => ({ ...current, [kind]: current[kind] ? 0 : 1 }));
  const bump = (kind: DeliverableKind, by: number) => setPicks((current) => ({ ...current, [kind]: Math.min(50, Math.max(1, (current[kind] ?? 1) + by)) }));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setTried(true);
    if (Object.keys(problems).length) return;
    setSending(true);
    setError(null);
    const result = await submitProjectRequest(workspaceId, input);
    setSending(false);
    if (!result.ok) { setError(result.error); return; }
    setSent(result.data.title);
    router.refresh();
  }

  if (sent) {
    return <section className="pt-card" role="status">
      <p className="pt-alert is-success"><CheckCircle2 />Sent. {studioName} has your request for “{sent}”.</p>
      <p className="pt-brief">You will get a notification when they reply. If they take it on, the project appears on your portal home with this brief attached.</p>
      <div className="pt-request-actions"><Link className="pt-cta" href="/portal/requests">See your requests</Link><Link className="pt-ghost" href="/">Back to your portal</Link></div>
    </section>;
  }

  return <form className="pt-form-layout" onSubmit={submit} noValidate>
    <div className="pt-form">
      <section className="pt-step" aria-labelledby="step-1">
        <header><span className="pt-step-no">1</span><div><h2 id="step-1">What should we make?</h2><p>Pick everything that applies. You can change the numbers.</p></div></header>
        {clientTeams.length > 1 && <label className="pt-field">On behalf of
          <select value={teamId} onChange={(event) => setTeamId(event.target.value)}>{clientTeams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select>
        </label>}
        <label className="pt-field">Working title
          <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} placeholder="e.g. Summer menu launch" aria-invalid={!!show("title")} />
          {show("title") && <small className="pt-field-error">{show("title")}</small>}
        </label>
        <div className="pt-catalog" role="group" aria-label="Deliverables">
          {DELIVERABLE_OPTIONS.map((option) => {
            const qty = picks[option.kind] ?? 0;
            return <label key={option.kind} className={`pt-option${qty ? " is-on" : ""}`}>
              <input type="checkbox" checked={qty > 0} onChange={() => toggle(option.kind)} />
              <strong>{option.label}</strong><small>{option.hint}</small>
              {qty > 0 && <span className="pt-qty" onClick={(event) => event.preventDefault()}>
                <button type="button" onClick={() => bump(option.kind, -1)} aria-label={`Fewer ${option.label}`}><Minus size={12} /></button>
                <span aria-live="polite">{qty}</span>
                <button type="button" onClick={() => bump(option.kind, 1)} aria-label={`More ${option.label}`}><Plus size={12} /></button>
              </span>}
            </label>;
          })}
        </div>
        {show("deliverables") && <p className="pt-alert is-error"><TriangleAlert />{show("deliverables")}</p>}
      </section>

      <section className="pt-step" aria-labelledby="step-2">
        <header><span className="pt-step-no">2</span><div><h2 id="step-2">Where will it live?</h2><p>Optional, but it helps the studio quote and plan.</p></div></header>
        <div className="pt-field">Platform<div className="pt-chips">{PLATFORM_OPTIONS.map((value) => <button type="button" key={value} className="pt-chip" aria-pressed={platform === value} onClick={() => setPlatform(platform === value ? null : value)}>{value}</button>)}</div></div>
        <div className="pt-grid-2">
          <div className="pt-field">Shape<div className="pt-chips">{ASPECT_OPTIONS.map((value) => <button type="button" key={value} className="pt-chip" aria-pressed={aspect === value} onClick={() => setAspect(aspect === value ? null : value)}>{value}</button>)}</div></div>
          <div className="pt-field">Rough length<div className="pt-chips">{LENGTH_OPTIONS.map((option) => <button type="button" key={option.value} className="pt-chip" aria-pressed={length === option.value} onClick={() => setLength(length === option.value ? null : option.value)}>{option.label}</button>)}</div></div>
        </div>
      </section>

      <section className="pt-step" aria-labelledby="step-3">
        <header><span className="pt-step-no">3</span><div><h2 id="step-3">The brief</h2><p>What is it for, who should it reach, and what does good look like?</p></div></header>
        <label className="pt-field">Brief
          <textarea value={brief} onChange={(event) => setBrief(event.target.value)} maxLength={5000} placeholder="We are launching three cold brews in June and want…" aria-invalid={!!show("brief")} />
          {show("brief") ? <small className="pt-field-error">{show("brief")}</small> : <small>{brief.length}/5000</small>}
        </label>
        <label className="pt-field">References <small>Links to work you like, one per line</small>
          <textarea value={references} onChange={(event) => setReferences(event.target.value)} maxLength={2000} rows={3} style={{ minHeight: 80 }} placeholder="https://" />
        </label>
        <div className="pt-grid-2">
          <label className="pt-field">Needed by
            <input type="date" value={wantedBy} min={today} onChange={(event) => setWantedBy(event.target.value)} aria-invalid={!!show("wanted_by")} />
            {show("wanted_by") && <small className="pt-field-error">{show("wanted_by")}</small>}
          </label>
          <label className="pt-field">Budget range
            <select value={budget} onChange={(event) => setBudget(event.target.value)}>
              <option value="">Prefer not to say</option>
              {BUDGET_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
        </div>
        <small style={{ color: "var(--muted)" }}>Have footage or brand files already? Once the project is open you can send them from its page.</small>
      </section>

      {error && <p className="pt-alert is-error" role="alert"><TriangleAlert />{error}</p>}
      <div className="pt-form-foot">
        <p>{studioName} reviews requests and replies in the portal.</p>
        <button className="pt-cta" disabled={sending}><Send />{sending ? "Sending…" : "Send request"}</button>
      </div>
    </div>

    <aside className="pt-summary" aria-label="Request summary">
      <h2>Your request</h2>
      <dl>
        <div><dt>Title</dt><dd>{title.trim() || "—"}</dd></div>
        <div><dt>Deliverables</dt><dd>{deliverables.length ? deliverablesSummary(deliverables) : "Nothing picked yet"}</dd></div>
        <div><dt>Format</dt><dd>{[platform, aspect, LENGTH_OPTIONS.find((option) => option.value === length)?.label].filter(Boolean).join(" · ") || "—"}</dd></div>
        <div><dt>Needed by</dt><dd>{wantedBy ? dayDate(wantedBy) : "Flexible"}</dd></div>
        <div><dt>Budget</dt><dd>{budgetLabel(budget) ?? "Not shared"}</dd></div>
      </dl>
    </aside>
  </form>;
}
