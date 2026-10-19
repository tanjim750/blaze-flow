/* Hand-drawn stroke paths. A plain module (not "use client") so server components can read them too. */

export const STROKES = {
  circle: { viewBox: "0 0 300 120", d: "M150 10 C60 6 10 30 14 62 C18 98 110 112 190 106 C270 100 296 70 286 44 C276 16 210 8 120 16" },
  wave: { viewBox: "0 0 300 30", d: "M4 18 C30 6 50 28 78 16 C106 4 126 28 154 16 C182 4 204 28 232 16 C256 6 276 24 296 14" },
  arrow: { viewBox: "0 0 160 90", d: "M150 12 C110 6 60 20 30 64 M30 64 L28 38 M30 64 L54 58" },
  arrowDown: { viewBox: "0 0 120 80", d: "M8 8 C40 10 80 30 104 66 M104 66 L80 62 M104 66 L106 42" },
  star: { viewBox: "0 0 120 120", d: "M60 8 L72 46 L112 46 L80 70 L92 110 L60 86 L28 110 L40 70 L8 46 L48 46 Z" },
} as const;

