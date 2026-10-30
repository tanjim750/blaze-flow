import { Suspense } from "react";
import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import "./interactions.css";
import "./light-polish.css";
import "@/components/brand/brand.css";
import { NavProgress } from "@/components/nav-progress";
import { SubmitFeedback } from "@/components/submit-feedback";
import { UploadTray } from "@/components/uploads/upload-tray";
import { UploadRefresh } from "@/components/uploads/upload-refresh";
import { siteConfig } from "@/lib/site-config";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
import { ThemeSync } from "@/components/theme/use-theme";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/** `cover` lets the mobile top bar pad itself with the safe-area insets. */
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

export const metadata: Metadata = {
  title: siteConfig.name,
  description: siteConfig.description,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      {/* Applies the saved Dark/Light/System theme before first paint (no flash). */}
      <head><script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} /></head>
      <body className="min-h-full flex flex-col">
        <Suspense fallback={null}><NavProgress /></Suspense>
        <ThemeSync />
        <SubmitFeedback />
        <UploadTray />
        <UploadRefresh />
        {children}
      </body>
    </html>
  );
}
