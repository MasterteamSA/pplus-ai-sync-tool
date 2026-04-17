#!/usr/bin/env node
/**
 * Find the first free port starting at 3000, then spawn `next dev` on it.
 * Prevents EADDRINUSE crashes when another dev server is already bound.
 *
 * Usage (invoked by `pnpm dev` at the repo root):
 *   node scripts/dev.mjs [--port <base>] [--max <tries>]
 */

import { spawn, spawnSync } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
let base = Number(process.env.PORT ?? 3000);
let max = 20;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--port" && args[i + 1]) { base = Number(args[i + 1]); i++; }
  else if (args[i] === "--max" && args[i + 1]) { max = Number(args[i + 1]); i++; }
}

function probe(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.once("listening", () => srv.close(() => resolve(true)));
    srv.listen(port, "0.0.0.0");
  });
}

async function pickPort() {
  for (let i = 0; i < max; i++) {
    const port = base + i;
    if (await probe(port)) return port;
  }
  throw new Error(`no free port in range ${base}..${base + max - 1}`);
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const webDir = path.join(repoRoot, "apps", "web");
const port = await pickPort();
spawnSync("node", [path.join(repoRoot, "scripts", "banner.mjs"), `Booting on http://localhost:${port}`], {
  stdio: "inherit",
});
if (port !== base) {
  console.log(`\u001b[33m!\u001b[0m port ${base} was busy; using ${port} instead`);
}

const child = spawn("pnpm", ["exec", "next", "dev", "--turbopack", "-p", String(port)], {
  cwd: webDir,
  stdio: "inherit",
  env: { ...process.env, PORT: String(port) },
});
child.on("exit", (code) => process.exit(code ?? 0));
