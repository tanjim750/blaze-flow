"use client";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Plus } from "lucide-react";

/**
 * Inline "add a task" for one column. Enter creates and keeps the composer open for the next
 * one; Escape clears the text, then closes. Focus goes back to the button that opened it.
 */
export function QuickAdd({ stageName, open, onOpenChange, onCreate, disabledReason }: {
  stageName: string; open: boolean; onOpenChange: (open: boolean) => void; onCreate: (title: string) => Promise<boolean>; disabledReason?: string | null;
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (open) input.current?.focus(); }, [open]);

  if (disabledReason) return <p className="tb-quick-hint">{disabledReason}</p>;
  if (!open) return <button ref={opener} type="button" className="tb-quick-open" onClick={() => onOpenChange(true)}><Plus aria-hidden="true" />Add task</button>;

  async function submit() {
    const title = value.replace(/\s+/g, " ").trim();
    if (!title || busy) return;
    setBusy(true);
    const ok = await onCreate(title);
    setBusy(false);
    if (ok) { setValue(""); input.current?.focus(); }
  }
  function close() { onOpenChange(false); requestAnimationFrame(() => opener.current?.focus()); }
  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    event.stopPropagation();
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void submit(); }
    if (event.key === "Escape") { event.preventDefault(); if (value) setValue(""); else close(); }
  }
  return <div className="tb-quick" data-no-dnd>
    <textarea
      ref={input} rows={1} value={value} disabled={busy}
      aria-label={`New task in ${stageName}`} placeholder="Task title…"
      onChange={(event) => setValue(event.target.value)} onKeyDown={onKeyDown}
      onBlur={() => { if (!value.trim()) onOpenChange(false); }}
    />
    <div className="tb-quick-actions">
      <span className="tb-hint">Enter to add · Esc to close</span>
      <button type="button" className="tb-button is-primary is-sm" onMouseDown={(event) => event.preventDefault()} onClick={() => void submit()} disabled={busy || !value.trim()}>{busy ? "Adding…" : "Add"}</button>
    </div>
  </div>;
}
