import { Bricolage_Grotesque, Caveat } from "next/font/google";
import { siteConfig } from "@/lib/site-config";
import { Playful } from "./playful";
import "./playful.css";

const display = Bricolage_Grotesque({ subsets: ["latin"], axes: ["wdth", "opsz"], variable: "--pl-display" });
const hand = Caveat({ subsets: ["latin"], variable: "--pl-hand" });

export const metadata = { title: `Playful · homepage mockup · ${siteConfig.name}` };

export default function PlayfulPage() {
  return <div className={`${display.variable} ${hand.variable}`}><Playful /></div>;
}
