import { ImageResponse } from "next/og";
import { siteConfig } from "@/lib/site-config";

/**
 * `/og.png`: the social card for every public page (see `lib/marketing-metadata.ts`).
 * Text comes from siteConfig, so a rename updates it. A route handler rather than the
 * `opengraph-image` file convention because each page sets its own `openGraph` object,
 * which would otherwise replace the inherited image.
 */
const size = { width: 1200, height: 630 };
export const dynamic = "force-static";

export function GET() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 72, background: "radial-gradient(circle at 80% 0%, rgba(139,108,255,.55), transparent 55%), linear-gradient(160deg, #15121f 0%, #0d0d11 70%)", color: "#f4f3f8", fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div style={{ width: 64, height: 64, borderRadius: 18, background: "linear-gradient(145deg, #9c7cff, #5a35e8)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" /></svg>
          </div>
          <div style={{ fontSize: 40, fontWeight: 700, letterSpacing: -1 }}>{siteConfig.name}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div style={{ fontSize: 70, fontWeight: 800, lineHeight: 1.05, letterSpacing: -3, maxWidth: 1000 }}>{siteConfig.tagline}</div>
          <div style={{ fontSize: 28, color: "#b9b6c8" }}>Video review · Client approvals · AI Visual QA · Client portal</div>
        </div>
        <div style={{ display: "flex", gap: 14 }}>
          {["Built for video agencies", `${siteConfig.pricing.trialDays}-day free trial`].map((label) => (
            <div key={label} style={{ display: "flex", padding: "10px 20px", borderRadius: 999, border: "1px solid #55418f", background: "rgba(42,33,73,.8)", color: "#d9d0ff", fontSize: 24 }}>{label}</div>
          ))}
        </div>
      </div>
    ),
    size,
  );
}
