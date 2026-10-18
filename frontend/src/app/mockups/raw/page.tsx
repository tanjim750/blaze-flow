import { Space_Mono } from "next/font/google";
import { siteConfig } from "@/lib/site-config";
import { Raw } from "./raw";
import "./raw.css";

const mono = Space_Mono({ subsets: ["latin"], weight: ["400", "700"], style: ["normal", "italic"], variable: "--rw-mono" });

export const metadata = { title: `Raw · homepage mockup · ${siteConfig.name}` };

export default function RawPage() {
  return <div className={mono.variable}><Raw /></div>;
}
