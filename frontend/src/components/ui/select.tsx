"use client";

/**
 * Themed select: a drop-in for native `<select>` in forms. The OS popup clashes with the
 * navy theme, so this renders a Radix popover listbox instead and mirrors the value into a
 * real (visually hidden) input so form actions and `required` keep working.
 *
 * Keyboard: Enter/Space/ArrowDown opens, arrows move, Home/End jump, Enter picks, Escape
 * closes, and typing filters (a search box appears once the list is longer than 8).
 */
import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { Check, ChevronDown, Search } from "@/components/icons";
import { cn } from "@/lib/utils";
import "./select.css";

export type SelectOption = { value: string; label: string; disabled?: boolean };

export function Select({
  name, options, value, defaultValue, onValueChange, placeholder = "Select…", required, disabled,
  className, searchable, id, "aria-label": ariaLabel, "aria-invalid": ariaInvalid,
}: {
  name?: string; options: SelectOption[]; value?: string; defaultValue?: string;
  onValueChange?: (value: string) => void; placeholder?: string; required?: boolean; disabled?: boolean;
  className?: string; searchable?: boolean; id?: string; "aria-label"?: string; "aria-invalid"?: boolean;
}) {
  const [inner, setInner] = React.useState(defaultValue ?? "");
  const current = value ?? inner;
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [active, setActive] = React.useState(0);
  const listId = React.useId();
  const listRef = React.useRef<HTMLUListElement>(null);
  const showSearch = searchable ?? options.length > 8;
  const shown = React.useMemo(
    () => options.filter((option) => option.label.toLowerCase().includes(query.trim().toLowerCase())),
    [options, query],
  );
  const selected = options.find((option) => option.value === current);

  const pick = (option: SelectOption) => {
    if (option.disabled) return;
    if (value === undefined) setInner(option.value);
    onValueChange?.(option.value);
    setOpen(false);
  };
  const openList = (next: boolean) => {
    setOpen(next);
    if (next) { setQuery(""); setActive(Math.max(0, options.findIndex((o) => o.value === current))); }
  };
  React.useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView?.({ block: "nearest" });
  }, [active, open]);

  const onKey = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") { event.preventDefault(); setActive((i) => Math.min(shown.length - 1, i + 1)); }
    else if (event.key === "ArrowUp") { event.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
    else if (event.key === "Home") { event.preventDefault(); setActive(0); }
    else if (event.key === "End") { event.preventDefault(); setActive(shown.length - 1); }
    else if (event.key === "Enter" || (event.key === " " && !showSearch)) { event.preventDefault(); if (shown[active]) pick(shown[active]); }
    else if (!showSearch && event.key.length === 1) {
      const index = shown.findIndex((o) => o.label.toLowerCase().startsWith(event.key.toLowerCase()));
      if (index >= 0) setActive(index);
    }
  };

  return <PopoverPrimitive.Root open={open} onOpenChange={openList}>
    <PopoverPrimitive.Trigger asChild disabled={disabled}>
      <button
        type="button" id={id} className={cn("ui-select-trigger", className)} role="combobox"
        aria-expanded={open} aria-controls={listId} aria-haspopup="listbox" aria-label={ariaLabel} aria-invalid={ariaInvalid}
        onKeyDown={(event) => { if (!open && (event.key === "ArrowDown" || event.key === "ArrowUp")) { event.preventDefault(); openList(true); } }}
      >
        <span className={selected ? "" : "is-placeholder"}>{selected?.label ?? placeholder}</span>
        <ChevronDown aria-hidden="true" />
      </button>
    </PopoverPrimitive.Trigger>
    {name !== undefined && <input
      className="ui-select-native" tabIndex={-1} aria-hidden="true" name={name} value={current}
      required={required} onChange={() => {}} onFocus={() => openList(true)}
    />}
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        className="ui-select-content" align="start" sideOffset={6} collisionPadding={8}
        onKeyDown={onKey} onOpenAutoFocus={(event) => { if (!showSearch) { event.preventDefault(); listRef.current?.focus(); } }}
      >
        {showSearch && <label className="ui-select-search"><Search aria-hidden="true" />
          <input autoFocus value={query} placeholder="Search…" aria-label="Search options" aria-controls={listId}
            aria-activedescendant={shown[active] ? `${listId}-${active}` : undefined}
            onChange={(event) => { setQuery(event.target.value); setActive(0); }} />
        </label>}
        <ul ref={listRef} id={listId} role="listbox" tabIndex={-1} aria-label={ariaLabel}
          aria-activedescendant={shown[active] ? `${listId}-${active}` : undefined}>
          {shown.map((option, index) => {
            const isSelected = option.value === current;
            return <li key={option.value || "__empty"} id={`${listId}-${index}`} data-index={index} role="option"
              aria-selected={isSelected} aria-disabled={option.disabled || undefined}
              className={cn(index === active && "is-active", isSelected && "is-selected")}
              onMouseMove={() => setActive(index)} onClick={() => pick(option)}>
              <span>{option.label}</span>{isSelected && <Check aria-hidden="true" />}
            </li>;
          })}
          {shown.length === 0 && <li className="ui-select-empty" role="presentation">No matches</li>}
        </ul>
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Portal>
  </PopoverPrimitive.Root>;
}
