import type { Metadata } from "next";
import { MockupMotion } from "@/components/mockups/motion-config";

/** Design-direction mockups for the homepage. Not linked from anywhere, never indexed. */
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function MockupsLayout({ children }: { children: React.ReactNode }) {
  return <div style={{ width: "100%", minHeight: "100vh" }}><MockupMotion>{children}</MockupMotion></div>;
}
