import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";

export const metadata: Metadata = {
  title: "Klear — every rupee, cleared",
  applicationName: "Klear",
  description:
    "Human-gated AI back office for merchants on Cashfree: three-way payment reconciliation, failed-payment recovery and explainable fraud defense.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Klear",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  themeColor: "#101820",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="font-sans">{children}</body>
    </html>
  );
}
