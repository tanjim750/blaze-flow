"use client";

import { useId, type InputHTMLAttributes, type ReactNode } from "react";

type Props = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  name: string;
  icon?: ReactNode;
  error?: string;
  hint?: string;
};

export function TextField({ label, icon, error, hint, ...input }: Props) {
  const id = useId();
  const describedBy = [error ? `${id}-error` : "", hint ? `${id}-hint` : ""].filter(Boolean).join(" ") || undefined;
  return (
    <div className="auth-field">
      <div className="auth-label-row"><label htmlFor={id}>{label}</label></div>
      <div className={`field${error ? " is-invalid" : ""}`}>
        {icon}
        <input id={id} aria-invalid={error ? true : undefined} aria-describedby={describedBy} {...input} />
      </div>
      {hint && !error && <p className="auth-hint" id={`${id}-hint`}>{hint}</p>}
      {error && <p className="field-error" id={`${id}-error`}>{error}</p>}
    </div>
  );
}

export function SubmitButton({ busy, children, busyLabel }: { busy: boolean; children: ReactNode; busyLabel: string }) {
  return (
    <button className="button primary submit" type="submit" disabled={busy} aria-busy={busy || undefined}>
      {busy ? <><span className="auth-spinner" aria-hidden />{busyLabel}</> : children}
    </button>
  );
}

export function FormAlert({ children, tone = "error" }: { children: ReactNode; tone?: "error" | "info" | "success" }) {
  if (!children) return null;
  return <div className={`auth-alert is-${tone}`} role={tone === "error" ? "alert" : "status"}>{children}</div>;
}
