"use client";

import { useActionState } from "react";
import { Check, Minus } from "@/components/icons";
import type { WorkspacePlan } from "@/lib/api";
import { formatMoney } from "@/lib/money";
import type { PlanOption } from "@/lib/plan";
import { changePlanAction, type PlanState } from "./actions";

const INITIAL: PlanState = { error: null, message: null };

/** Solo plus the three studio tiers. Studio tiers all map to the backend's PRO for now. */
export function PlanPicker({ options, current, currency, canChange, excluded }: {
  options: PlanOption[]; current: PlanOption["id"] | null; currency: string; canChange: boolean; excluded: readonly string[];
}) {
  const [state, action, pending] = useActionState(changePlanAction, INITIAL);
  return <div className="plan-picker">
    {state.error && <p className="form-error" role="alert">{state.error}</p>}
    {state.message && <p className="form-success" role="status">{state.message}</p>}
    <div className="plan-options" role="list">
      {options.map((option) => {
        const isCurrent = option.id === current;
        return <article key={option.id} role="listitem" className={`plan-option${isCurrent ? " is-current" : ""}${option.highlighted ? " is-featured" : ""}`} data-plan={option.id}>
          <header>
            <h3>{option.name}{isCurrent && <span className="plan-current">Current</span>}{option.highlighted && !isCurrent && <span className="plan-popular">Most popular</span>}</h3>
            <p className="plan-price"><strong>{formatMoney(option.monthly, currency)}</strong><small>/mo</small></p>
            <p className="plan-meta">{option.users} · {option.storage}</p>
          </header>
          <ul>{option.points.map((point) => <li key={point}><Check size={13} aria-hidden="true" />{point}</li>)}</ul>
          {option.id === "solo" && <ul className="is-excluded" aria-label="Not in Solo">{excluded.map((point) => <li key={point}><Minus size={13} aria-hidden="true" />{point}</li>)}</ul>}
          <form action={action}>
            <input type="hidden" name="plan" value={option.backend satisfies Exclude<WorkspacePlan, "FREE">} />
            <input type="hidden" name="label" value={option.name} />
            <button type="submit" className={`plan-choose${option.id === "solo" || isCurrent ? " is-ghost" : ""}`} disabled={!canChange || isCurrent || pending}>
              {isCurrent ? "Your plan" : option.id === "solo" ? "Switch to Solo" : `Choose ${option.name}`}
            </button>
          </form>
        </article>;
      })}
    </div>
  </div>;
}
