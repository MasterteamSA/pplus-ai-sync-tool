import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PPlus AI Sync Tool",
  description: "Standalone AI-powered configuration sync across PPlus instances.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="min-h-screen">
          <header className="border-b border-black/10 dark:border-white/10">
            <div className="mx-auto max-w-5xl px-6 py-4 flex items-center justify-between">
              <a href="/" className="font-semibold tracking-tight">
                PPlus <span className="opacity-60">AI Sync</span>
              </a>
              <nav className="text-sm space-x-4 opacity-80">
                <a href="/connect">Connect</a>
                <a href="/snapshot">Snapshot</a>
                <a href="/match">Match</a>
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
