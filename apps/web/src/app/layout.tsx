import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geist = Geist({
  subsets: ["latin"],
  variable: "--font-sans",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "Newshog",
  description:
    "Paste a breaking-news URL and get a newsjack score, ranked angles, matched journalists, and a ready-to-send pitch in about 30 seconds.",
  openGraph: {
    title: "Newshog",
    description:
      "Paste a breaking-news URL and get a newsjack score, ranked angles, matched journalists, and a ready-to-send pitch in about 30 seconds.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} ${geistMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
