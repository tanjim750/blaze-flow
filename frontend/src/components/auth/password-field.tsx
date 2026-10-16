"use client";

import { Eye, EyeOff, LockKeyhole } from "lucide-react";
import { useId, useState } from "react";
import { passwordStrength } from "@/lib/password-strength";

type Props = {
  name: string;
  label: string;
  autoComplete: "current-password" | "new-password";
  placeholder?: string;
  error?: string;
  /** Show the strength meter (sign-up / reset). Words here are penalised (name, email). */
  meter?: boolean;
  context?: string[];
  value?: string;
  onChange?: (value: string) => void;
  labelAside?: React.ReactNode;
  autoFocus?: boolean;
};

export function PasswordField({ name, label, autoComplete, placeholder, error, meter, context = [], value, onChange, labelAside, autoFocus }: Props) {
  const id = useId();
  const [show, setShow] = useState(false);
  const [local, setLocal] = useState("");
  const current = value ?? local;
  const strength = meter ? passwordStrength(current, context) : null;
  const describedBy = [error ? `${id}-error` : "", strength ? `${id}-hint` : ""].filter(Boolean).join(" ") || undefined;
  return (
    <div className="auth-field">
      <div className="auth-label-row">
        <label htmlFor={id}>{label}</label>
        {labelAside}
      </div>
      <div className={`field${error ? " is-invalid" : ""}`}>
        <LockKeyhole aria-hidden />
        <input
          id={id}
          name={name}
          type={show ? "text" : "password"}
          placeholder={placeholder}
          autoComplete={autoComplete}
          autoCapitalize="none"
          spellCheck={false}
          required
          minLength={autoComplete === "new-password" ? 8 : undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          value={current}
          autoFocus={autoFocus}
          onChange={(event) => { setLocal(event.target.value); onChange?.(event.target.value); }}
        />
        <button
          type="button"
          className="field-toggle"
          onClick={() => setShow((v) => !v)}
          aria-label={show ? "Hide password" : "Show password"}
          aria-pressed={show}
        >
          {show ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
        </button>
      </div>
      {strength && (
        <div className="auth-strength" id={`${id}-hint`} aria-live="polite">
          <div className="auth-strength-bar" data-score={strength.score} aria-hidden>
            <i /><i /><i /><i />
          </div>
          <p>{strength.label && <b>{strength.label}. </b>}{strength.hint}</p>
        </div>
      )}
      {error && <p className="field-error" id={`${id}-error`}>{error}</p>}
    </div>
  );
}
