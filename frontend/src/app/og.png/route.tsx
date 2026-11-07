import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { siteConfig } from "@/lib/site-config";

/**
 * `/og.png`: the social card for every public page (see `lib/marketing-metadata.ts`), in
 * the site's playful style. Text comes from siteConfig, so a rename updates it. A route
 * handler rather than the `opengraph-image` file convention because each page sets its own
 * `openGraph` object, which would otherwise replace the inherited image.
 *
 * Rendered once at build time. The fonts are static instances of the site's typefaces
 * (Bricolage Grotesque, Caveat; both SIL Open Font License) kept next to this file, because
 * the OG renderer cannot use variable fonts or next/font.
 */
const size = { width: 1200, height: 630 };
export const dynamic = "force-static";

const INK = "#1d1a16";
const font = (file: string) => readFile(join(process.cwd(), "src/app/og.png/fonts", file));

export async function GET() {
  const [display, body, hand] = await Promise.all([
    font("bricolage-grotesque-800-condensed.ttf"),
    font("bricolage-grotesque-600.ttf"),
    font("caveat-700.ttf"),
  ]);
  const { symbol, proMonthly, trialDays } = siteConfig.pricing;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", position: "relative", background: "#fff1dc", color: INK, fontFamily: "Body", padding: 64, backgroundImage: "radial-gradient(rgba(29,26,22,.12) 2px, transparent 2px)", backgroundSize: "26px 26px" }}>
        {/* clay shapes */}
        <div style={{ position: "absolute", right: 86, top: 70, width: 150, height: 150, borderRadius: 999, background: "radial-gradient(circle at 32% 28%, #ffb4a3 0%, #ff5533 45%, #c7321a 100%)", display: "flex" }} />
        <div style={{ position: "absolute", right: 300, top: 210, width: 70, height: 150, borderRadius: 40, background: "linear-gradient(100deg, #fff1b0 0%, #ffc83d 40%, #e0a10e 100%)", transform: "rotate(-24deg)", display: "flex" }} />
        <div style={{ position: "absolute", right: 70, bottom: 120, width: 140, height: 140, borderRadius: 999, border: `30px solid #7cc8ff`, display: "flex" }} />

        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", width: "100%" }}>
          <div style={{ display: "flex" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "10px 22px 10px 12px", background: "#ffc83d", border: `4px solid ${INK}`, borderRadius: 18, boxShadow: `5px 5px 0 ${INK}`, transform: "rotate(-3deg)", fontFamily: "Display", fontSize: 38 }}>
              <div style={{ width: 46, height: 46, borderRadius: 999, background: "#ff5533", border: `3px solid ${INK}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={INK} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" /></svg>
              </div>
              {siteConfig.name}
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", fontFamily: "Display", fontSize: 108, lineHeight: 0.95, letterSpacing: -2 }}>
            <div style={{ display: "flex", position: "relative" }}>
              Circle it.
              <svg style={{ position: "absolute", left: -26, top: -22 }} width="470" height="150" viewBox="0 0 300 120" fill="none"><path d="M150 10 C60 6 10 30 14 62 C18 98 110 112 190 106 C270 100 296 70 286 44 C276 16 210 8 120 16" stroke="#ff5533" strokeWidth="5" strokeLinecap="round" /></svg>
            </div>
            <div style={{ display: "flex", color: "#d93a17" }}>Scribble it.</div>
            <div style={{ display: "flex" }}>Ship it.</div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <div style={{ display: "flex", fontSize: 28, color: "#5e554a", maxWidth: 560 }}>Video review, client approvals and AI proofreading for agencies.</div>
            <div style={{ display: "flex", padding: "10px 20px", background: "#8ee3b4", border: `4px solid ${INK}`, borderRadius: 16, boxShadow: `4px 4px 0 ${INK}`, transform: "rotate(-4deg)", fontFamily: "Display", fontSize: 30 }}>{trialDays} days free</div>
            <div style={{ display: "flex", fontFamily: "Hand", fontSize: 40, color: "#d93a17", transform: "rotate(-5deg)" }}>then {symbol}{proMonthly}/mo</div>
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Display", data: display, weight: 800, style: "normal" },
        { name: "Body", data: body, weight: 600, style: "normal" },
        { name: "Hand", data: hand, weight: 700, style: "normal" },
      ],
    },
  );
}
