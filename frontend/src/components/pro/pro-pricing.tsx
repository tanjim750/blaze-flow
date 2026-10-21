"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, Minus } from "lucide-react";
import { siteConfig } from "@/lib/site-config";
import { cn } from "@/lib/utils";
import { Reveal } from "./pro-home";

type Cell = boolean | string;

const { plans, compare, pricing } = siteConfig;

const CAPACITY: { label: string; values: Cell[] }[] = [
  { label: "Storage", values: plans.map((p) => p.features[0].replace(" storage", "")) },
  { label: "Team members", values: plans.map((p) => p.features[1].replace("Up to ", "").replace(" users", "")) },
  { label: "Clients", values: plans.map(() => "Unlimited") },
];

function Value({ v }: { v: Cell }) {
  if (v === true) return <><Check className="pro-cmp-yes" aria-hidden="true" /><span className="pro-sr">Included</span></>;
  if (v === false) return <><Minus className="pro-cmp-no" aria-hidden="true" /><span className="pro-sr">Not included</span></>;
  if (v === "to confirm") return <span className="pro-cmp-tbc">To confirm</span>;
  return <>{v}</>;
}

/**
 * Plan comparison. Desktop: a grid whose plan header sticks under the site header. Phones:
 * the same rows with one plan at a time, picked with 44px tabs, so nothing scrolls sideways.
 */
export function ProCompare() {
  const proIndex = Math.max(0, plans.findIndex((p) => p.highlighted));
  const [pick, setPick] = useState(proIndex);
  const groups = [{ group: "Capacity", rows: CAPACITY }, ...compare.map((g) => ({ group: g.group, rows: g.rows.map((r) => ({ label: r.label, values: [...r.values] as Cell[] })) }))];
  return (
    <section className="pro-compare" aria-labelledby="pro-compare-title" data-pick={pick}>
      <div className="pro-wrap">
        <Reveal><h2 id="pro-compare-title" className="pro-h2">Three plans, one table</h2></Reveal>

        <div className="pro-cmp-tabs" role="tablist" aria-label="Plan to show">
          {plans.map((p, i) => (
            <button key={p.id} type="button" role="tab" aria-selected={pick === i} onClick={() => setPick(i)} className={cn(p.highlighted && "is-featured")}>{p.name}</button>
          ))}
        </div>

        <div className="pro-cmp" role="table" aria-label="Plan comparison">
          <div className="pro-cmp-head" role="row">
            <div role="columnheader" className="pro-cmp-label"><span className="pro-sr">Feature</span></div>
            {plans.map((p, i) => (
              <div key={p.id} role="columnheader" className={cn("pro-cmp-plan", p.highlighted && "is-featured")} data-col={i}>
                <span className="pro-cmp-name">{p.name}{p.highlighted && <span className="pro-plan-pick">Most popular</span>}</span>
                <span className="pro-cmp-price">{pricing.symbol}{p.monthly}<small>/mo</small></span>
                {p.toConfirm && <span className="pro-badge">To confirm</span>}
                <Link className={cn("pro-btn is-sm", !p.highlighted && "is-ghost")} href={siteConfig.links.signUp}>Start trial</Link>
              </div>
            ))}
          </div>
          <div className="pro-ribbon" role="row"><span role="cell">Unlimited clients on every plan · {pricing.trialDays}-day free trial</span></div>
          {groups.map((g) => (
            <div key={g.group} role="rowgroup" className="pro-cmp-group">
              <div role="row" className="pro-cmp-grouphead"><span role="rowheader">{g.group}</span></div>
              {g.rows.map((r) => (
                <div key={r.label} role="row" className="pro-cmp-row">
                  <span role="rowheader" className="pro-cmp-label">{r.label}</span>
                  {r.values.map((v, i) => <span key={i} role="cell" className={cn("pro-cmp-cell", plans[i].highlighted && "is-featured")} data-col={i}><Value v={v} /></span>)}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
