"use client";

import { useState } from "react";
import "./pay-chooser.css";
import { optionNote, type PaymentOption } from "@/lib/payment-gateways";

/**
 * "Pay with" picker shown when the studio turned on more than one gateway. Options that can't
 * take this invoice stay visible (disabled) with the reason, so the payer isn't left guessing.
 */
export function PayChooser({ options, value, onChange, disabled = false, name = "pay-with" }: {
  options: PaymentOption[]; value: string | null; onChange: (provider: string) => void; disabled?: boolean; name?: string;
}) {
  return <fieldset className="pay-chooser" disabled={disabled}>
    <legend>Pay with</legend>
    {options.map((option) => {
      const note = optionNote(option);
      return <label key={option.provider} className={`pay-choice${value === option.provider ? " is-active" : ""}${option.available ? "" : " is-off"}`}>
        <input type="radio" name={name} value={option.provider} checked={value === option.provider} disabled={!option.available} onChange={() => onChange(option.provider)} />
        <span className="pay-choice-logo" aria-hidden="true">{option.name.slice(0, 1)}</span>
        <span className="pay-choice-text"><strong>{option.name}{option.sandbox && <em>Test mode</em>}</strong>
          <small>{note ?? (option.methods?.length ? option.methods.join(" · ") : "Card")}</small></span>
      </label>;
    })}
  </fieldset>;
}

/** The options worth showing a chooser for, and the default pick (first available). */
export function useGatewayChoice(options: PaymentOption[] | undefined) {
  const list = options ?? [];
  const [choice, setChoice] = useState<string | null>(() => list.find((option) => option.available)?.provider ?? null);
  return { list, choice, setChoice, showChooser: list.filter((option) => option.available).length > 1 };
}

export const PROVIDER_NAME: Record<string, string> = { stripe: "Stripe", paymongo: "PayMongo", safepay: "Safepay", sslcommerz: "SSLCOMMERZ" };
