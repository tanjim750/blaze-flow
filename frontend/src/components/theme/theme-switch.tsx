"use client";
import { useRef, type KeyboardEvent } from "react";
import { createIcon } from "@/components/icons/create-icon";
import { Monitor } from "@/components/icons";
import { THEME_OPTIONS, type ThemePreference } from "@/lib/theme";
import { useTheme } from "./use-theme";
import "./theme-switch.css";

export const Sun = createIcon("sun", "<circle cx=\"12\" cy=\"12\" r=\"4\"/><path d=\"M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8\"/>");
export const Moon = createIcon("moon", "<path d=\"M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z\"/>");

const LABEL: Record<ThemePreference, string> = { dark: "Dark", light: "Light", system: "System" };
const ICON = { dark: Moon, light: Sun, system: Monitor };

/**
 * Dark / Light / System segmented control (a radio group: arrow keys move the choice).
 * `compact` is the account-menu version: icons with short labels in one tight row.
 */
export function ThemeSwitch({ compact = false, label = "Theme" }: { compact?: boolean; label?: string }) {
  const { theme, setTheme } = useTheme();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = (index + step + THEME_OPTIONS.length) % THEME_OPTIONS.length;
    setTheme(THEME_OPTIONS[next]);
    refs.current[next]?.focus();
  };
  return (
    <div className={compact ? "theme-switch is-compact" : "theme-switch"} role="radiogroup" aria-label={label}>
      {THEME_OPTIONS.map((option, index) => {
        const Icon = ICON[option];
        const checked = theme === option;
        return (
          <button
            key={option}
            ref={(node) => { refs.current[index] = node; }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            className="theme-switch-option"
            onClick={() => setTheme(option)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            <Icon size={compact ? 14 : 16} aria-hidden="true" />
            <span>{LABEL[option]}</span>
          </button>
        );
      })}
    </div>
  );
}
