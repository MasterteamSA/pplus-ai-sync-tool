import type { Metadata } from "next";
import Image from "next/image";
import Script from "next/script";
import { ThemeToggle } from "@/components/theme-toggle";
import "./globals.css";

export const metadata: Metadata = {
  title: "PPlus AI Sync Tool",
  description: "Standalone AI-powered configuration sync across PPlus instances.",
  applicationName: "PPlus AI Sync",
  authors: [{ name: "Khalil @ Masterteam" }],
  themeColor: "#0b0d10",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <Script id="theme-init" strategy="beforeInteractive">
          {`(function(){try{var t=localStorage.getItem('theme');var d=t==='dark'||(!t&&window.matchMedia('(prefers-color-scheme: dark)').matches);if(d){document.documentElement.classList.add('dark');}}catch(e){}})();`}
        </Script>
      </head>
      <body>
        <div className="min-h-screen">
          <header className="border-b border-border backdrop-blur-sm">
            <div className="mx-auto max-w-5xl px-6 py-3 flex items-center justify-between gap-4">
              <a href="/" className="flex items-center gap-2.5 font-semibold tracking-tight hover:opacity-80 transition-opacity">
                <span className="inline-flex items-center justify-center rounded-md bg-muted p-1 ring-1 ring-border">
                  <Image src="/logo.png" alt="" width={24} height={24} priority className="rounded" />
                </span>
                <span>
                  PPlus <span className="opacity-60">AI Sync</span>
                </span>
              </a>
              <div className="flex items-center gap-4">
                <nav className="text-sm flex items-center gap-4 opacity-80">
                  <a href="/autopilot" className="font-semibold">Autopilot</a>
                  <span className="opacity-30">·</span>
                  <a href="/history">History</a>
                </nav>
                <ThemeToggle />
              </div>
            </div>
          </header>
          <main className="mx-auto max-w-5xl px-6 py-10">{children}</main>
        </div>
      </body>
    </html>
  );
}
