<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# UI conventions

**Build new UI from libraries, not from scratch.** Reach for an existing component before
writing one:

1. **shadcn/ui** first — `npx shadcn add <name>`. Config lives in `components.json`
   (Tailwind v4, CSS-variable theming, components land in `src/components/ui/`).
2. **Skiper UI** for animated/uncommon components — `npx shadcn add @skiper-ui/<name>`.
   The `@skiper-ui` registry is already declared in `components.json`. **Free tier only**;
   anything premium needs a licence we do not have. Free items are served at
   `https://skiper-ui.com/r/<name>.json` — a 200 there means it is free.
3. **Radix primitives** for behaviour that needs correct a11y (already a dependency).
4. Hand-written CSS only when nothing above fits.

**Animation** is expected, not decorative garnish — prefer a library component that already
animates over a static one. Honour `prefers-reduced-motion`; `useReducedMotion` from
`motion/react` is used in `app-shell.tsx` and `ui/dialog.tsx`.

## Rules when pulling in a registry component

- **Import `motion/react`, never `framer-motion`.** They are the same library under two
  names. The CLI will add `framer-motion` as a direct dependency — remove it; `motion`
  already depends on it, so a direct entry means a second copy and a second motion context.
- **Delete the vendor demo export.** Registry items ship a `SkiperNN` showcase component
  full of the vendor's own marketing copy and routes. Keep the real component, drop the demo.
- **Theme it.** Do not hard-code the vendor's colours. shadcn token names are mapped onto
  this app's palette in `src/app/shadcn-theme.css`, so `bg-background`,
  `text-muted-foreground` and friends resolve to the studio theme automatically.
- **Check the imports the CLI emits.** It has twice resolved things wrongly here: it wrote
  `import { cn } from "cn"` and installed an unrelated npm package literally named `cn` to
  satisfy it, and it pulled the `radix-ui` umbrella package alongside the individual
  `@radix-ui/react-*` packages this project already uses. Point `cn` at `@/lib/utils`, import
  the individual Radix package, and uninstall whatever the CLI added to paper over it.
- **Note local edits** in a comment at the top of the file, so a future re-add is diffable.
- **Check it against the surrounding CSS before shipping.** These components assume they own
  their layout. A per-character text effect breaks `text-overflow: ellipsis`; a fixed
  `line-height` clips descenders. Match the component to the constraints of the slot.

**Check a registry component against the test suite, not just the browser.** Radix's
Popover was added for the Files filter panel and is correct in a browser, but under jsdom
its Floating UI positioning polls without settling: opening the panel took a 130ms test to
1.8s, and opening it before a dialog hung the runner outright. Stubbing `ResizeObserver`
and `IntersectionObserver` did not help. A panel anchored to its own trigger, needing no
collision detection, is ~30 lines with `motion` — see `FilterPopover` in
`components/asset-library.tsx`. Prefer the library, but not at the cost of a suite that
hangs.

**Anything that portals cannot use the `--shell-*` variables.** Radix renders
`PopoverContent`, `SelectContent`, `DropdownMenuContent` and dialogs into `document.body`,
which is outside `.studio-shell` where those tokens are declared. A rule like
`background: var(--shell-container)` there resolves to nothing and the panel comes out
fully transparent over the page. Use the `:root` palette from `globals.css` instead —
`--surface`, `--surface-2`, `--border`, `--text`, `--muted`, `--primary`, `--hover`.

shadcn components use a bare `border` utility and take its colour from a base-layer
default. `shadcn-theme.css` supplies that in `@layer base`; without it the browser falls
back to `currentColor` and every panel gets a stark white outline.

`src/app/shadcn-theme.css` maps one way only: the palette in `shell.css` is the source of
truth and is never redefined. `--muted` in particular means *text colour* here and *surface*
in shadcn, so it is bridged, not overwritten.

## Sizing a video to its own shape

`width/height: 100%` with `object-fit: contain` looks like it letterboxes and does not, if
the container's height is not definite from the item's side — a grid row, or a flex child
that has not been told. The percentage resolves to `auto`, the video falls back to its
intrinsic ratio at full width, `object-fit` has nothing left to do, and `overflow: hidden`
crops whatever does not fit. A portrait clip loses its top and bottom entirely.

Wrap the picture in a frame carrying the media's own `aspect-ratio` (read from
`videoWidth`/`videoHeight` on load) with `max-width: 100%; max-height: 100%`. See
`.rvp-frame` in the player and `.rv-compare-frame` in compare — both exist because this was
written wrong twice.

## Media elements and hydration

Pages here are server-rendered, so the browser starts loading a `<video>`/`<audio>` as soon
as the HTML lands — usually **before** hydration attaches any React handler. `onLoadedMetadata`
and `onError` are then never called, silently:

- a missed `loadedmetadata` leaves duration at `0`, which collapsed every comment marker in
  the review timeline onto 0%;
- a missed `error` leaves a blank stage where the "still transcoding" placeholder belongs.

Read the element's own `readyState`, `duration` and `error` in an effect on mount, and use
listeners for anything after that. `app/(app)/review/player.tsx` has the pattern. Neither
failure shows up in the type checker, the linter, or the test suite — only in a browser.
