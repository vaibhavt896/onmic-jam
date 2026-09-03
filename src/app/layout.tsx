import type { Metadata, Viewport } from "next";
import { Be_Vietnam_Pro, Bricolage_Grotesque, Geist_Mono } from "next/font/google";
import "./globals.css";

/**
 * Three families, six weights. Loaded through next/font, which self-hosts them,
 * subsets to latin and sets font-display: swap — build note 07, without a
 * request to Google on a Kanpur mobile connection.
 *
 * Display carries personality, body carries density, mono carries every number.
 */
const display = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--f-display",
  display: "swap",
});

const body = Be_Vietnam_Pro({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--f-body",
  display: "swap",
});

const mono = Geist_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--f-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "On Mic Community — Jam Session",
  description: "Prepay your seat for the On Mic jam — entry and one mocktail.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#0B0912",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  // The sticky bar sits above the iPhone home indicator via
  // env(safe-area-inset-bottom), which only reports a value under cover.
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
