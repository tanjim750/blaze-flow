/**
 * The review page's keyboard shortcuts, as the `?` overlay lists them.
 *
 * One list, read by the overlay, so the help cannot promise a key the page does not handle.
 * The handlers live in the player (transport) and the workspace (marking, comments, help);
 * `review-shortcuts.test.ts` checks every key here is one of theirs.
 */

/** `either`: the keys are alternatives (← or →), not a combination. */
export type Shortcut = { keys: string[]; label: string; either?: boolean };
export type ShortcutGroup = { title: string; items: Shortcut[] };

export const REVIEW_SHORTCUTS: ShortcutGroup[] = [
  {
    title: "Playback",
    items: [
      { keys: ["Space"], label: "Play / pause" },
      { keys: ["K"], label: "Play / pause, back to 1×" },
      { keys: ["L"], label: "Play; press again to speed up (1.5×, 2×)" },
      { keys: ["J"], label: "Back 1 second" },
      { keys: ["←", "→"], label: "Previous / next frame", either: true },
      { keys: ["Shift", "←/→"], label: "Back / forward 1 second" },
      { keys: ["M"], label: "Mute" },
      { keys: ["F"], label: "Fullscreen" },
    ],
  },
  {
    title: "Ranges",
    items: [
      { keys: ["I"], label: "Mark in at the playhead" },
      { keys: ["O"], label: "Mark out (in defaults to 5s earlier)" },
      { keys: ["Shift", "drag"], label: "Drag on the timeline to mark a range" },
      { keys: ["Esc"], label: "Stop looping, then clear the range" },
    ],
  },
  {
    title: "Comments",
    items: [
      { keys: ["C"], label: "Write a comment at the playhead" },
      { keys: ["⌘/Ctrl", "Enter"], label: "Send the comment" },
      { keys: ["Esc"], label: "Leave the comment box (keeps the draft)" },
      { keys: ["?"], label: "Show these shortcuts" },
    ],
  },
];

/** Single keys the workspace itself handles (the rest belong to the player). */
export const WORKSPACE_KEYS = ["i", "o", "c", "?", "Escape"] as const;
/** Single keys the player handles. */
export const PLAYER_KEYS = [" ", "k", "l", "j", "ArrowLeft", "ArrowRight", "m", "f"] as const;
