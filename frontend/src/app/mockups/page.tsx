import Link from "next/link";
import { siteConfig } from "@/lib/site-config";

export const metadata = { title: `Homepage mockups · ${siteConfig.name}` };

const DIRECTIONS = [
  { href: "/mockups/cinematic", name: "Cinematic", note: "Dark, film-like, product-led" },
  { href: "/mockups/playful", name: "Playful", note: "Bright, hand-made, springy" },
  { href: "/mockups/raw", name: "Raw", note: "Brutalist, monospace, tool-like" },
];

export default function MockupsIndex() {
  return (
    <main style={{ padding: 40, fontFamily: "monospace", color: "#eee", background: "#111", minHeight: "100vh" }}>
      <h1 style={{ fontSize: 20 }}>{siteConfig.name}: homepage directions</h1>
      <ul style={{ lineHeight: 2.4 }}>
        {DIRECTIONS.map((d) => <li key={d.href}><Link href={d.href} style={{ textDecoration: "underline" }}>{d.name}</Link>: {d.note}</li>)}
      </ul>
    </main>
  );
}
