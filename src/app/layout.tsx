import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { ThemeProvider } from "next-themes";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Paper2Bench — from paper to an inspectable reproduction",
  description:
    "Evidence-first research engineering workspace: turn an ML paper into an evidence-backed, reproducible experiment. Local-first, honest unknowns, deterministic scaffolds.",
  keywords: [
    "Paper2Bench",
    "reproducibility",
    "ML research",
    "evidence ledger",
    "paper to code",
    "experiment scaffold",
  ],
  authors: [{ name: "Paper2Bench" }],
  manifest: "/manifest.webmanifest",
  applicationName: "Paper2Bench",
  openGraph: {
    title: "Paper2Bench",
    description:
      "Turn an ML paper into an evidence-backed, inspectable reproduction — claims linked to sources, honest unknowns, deterministic scaffolds, measured-vs-reported comparison.",
    type: "website",
    siteName: "Paper2Bench",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f2ea" },
    { media: "(prefers-color-scheme: dark)", color: "#0d0a06" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        suppressHydrationWarning
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground min-h-screen flex flex-col`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
