import { IBM_Plex_Mono, Instrument_Serif } from "next/font/google";
import { siteConfig } from "@/lib/site-config";
import { Cinematic } from "./cinematic";
import "./cinematic.css";

const serif = Instrument_Serif({ subsets: ["latin"], weight: "400", style: ["normal", "italic"], variable: "--cn-serif" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--cn-mono" });

export const metadata = { title: `Cinematic · homepage mockup · ${siteConfig.name}` };

export default function CinematicPage() {
  return <div className={`${serif.variable} ${mono.variable}`}><Cinematic /></div>;
}
