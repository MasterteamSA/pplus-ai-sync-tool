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
import fs from "node:fs";
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

function depsInstalled() {
  return (
    fs.existsSync(path.join(repoRoot, "node_modules")) &&
    fs.existsSync(path.join(webDir, "node_modules")) &&
    fs.existsSync(path.join(webDir, "node_modules", "next"))
  );
}

if (!depsInstalled()) {
  console.log("\u001b[33m!\u001b[0m node_modules missing — running pnpm install (first time only)");
  const install = spawnSync("pnpm", ["install"], { cwd: repoRoot, stdio: "inherit" });
  if (install.status !== 0) {
    console.error("\u001b[31m\u2717\u001b[0m pnpm install failed. Fix the error above and try again.");
    process.exit(install.status ?? 1);
  }
}

const migrationsDir = path.join(repoRoot, "packages", "db", "drizzle");
const hasMigrations =
  fs.existsSync(migrationsDir) &&
  fs.readdirSync(migrationsDir).some((f) => f.endsWith(".sql"));
if (!hasMigrations) {
  console.log("\u001b[33m!\u001b[0m no migrations yet — generating (first time only)");
  const gen = spawnSync(
    "pnpm",
    ["--filter", "@pplus-sync/db", "exec", "drizzle-kit", "generate", "--name", "init"],
    { cwd: repoRoot, stdio: "inherit" },
  );
  if (gen.status !== 0) {
    console.error("\u001b[31m\u2717\u001b[0m drizzle-kit generate failed. Check output above.");
    process.exit(gen.status ?? 1);
  }
}

const envLocal = path.join(repoRoot, ".env.local");
const envExample = path.join(repoRoot, ".env.example");
if (!fs.existsSync(envLocal) && fs.existsSync(envExample)) {
  fs.copyFileSync(envExample, envLocal);
  console.log("\u001b[32m\u2713\u001b[0m created .env.local from .env.example");
}

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
