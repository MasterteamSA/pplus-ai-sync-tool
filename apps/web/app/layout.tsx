import type { Metadata } from "next";
import Image from "next/image";
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
    <html lang="en">
      <body>
        <div className="min-h-screen">
          <header className="border-b border-black/10 dark:border-white/10 backdrop-blur-sm">
            <div className="mx-auto max-w-5xl px-6 py-3 flex items-center justify-between">
              <a href="/" className="flex items-center gap-2.5 font-semibold tracking-tight hover:opacity-80 transition-opacity">
                <span className="inline-flex items-center justify-center rounded-md bg-ink/5 dark:bg-paper/10 p-1 ring-1 ring-black/5 dark:ring-white/10">
                  <Image src="/logo.png" alt="" width={24} height={24} priority className="rounded" />
                </span>
                <span>
                  PPlus <span className="opacity-60">AI Sync</span>
                </span>
              </a>
              <nav className="text-sm flex items-center gap-4 opacity-80">
                <a href="/autopilot" className="font-semibold">Autopilot</a>
                <span className="opacity-30">·</span>
                <a href="/connect">Connect</a>
                <a href="/snapshot">Snapshot</a>
                <a href="/match">Match</a>
                <a href="/align">Align</a>
                <a href="/diff">Diff</a>
                <a href="/apply">Apply</a>
                <a href="/history">History</a>
              </nav>
            </div>
          </header>
          <main className="mx-auto max-w-5xl px-6 py-10">{children}</main>
        </div>
      </body>
    </html>
  );
}
