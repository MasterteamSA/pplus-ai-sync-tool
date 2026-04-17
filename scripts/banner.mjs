#!/usr/bin/env node
/**
 * PPlus AI Sync Tool — terminal banner.
 * Usage:   node scripts/banner.mjs [subtitle]
 */

const subtitle = process.argv.slice(2).join(" ").trim();

const isTTY = process.stdout.isTTY === true;
const color = (code, s) => (isTTY ? `\u001b[${code}m${s}\u001b[0m` : s);
const bold = (s) => color("1", s);
const dim = (s) => color("2", s);
const cyan = (s) => color("36", s);
const mag = (s) => color("35", s);
const grn = (s) => color("32", s);
const yel = (s) => color("33", s);

const grad = (s) => {
  if (!isTTY) return s;
  const palette = [39, 38, 69, 75, 81, 87, 123]; // soft cyan→blue gradient
  return [...s].map((ch, i) => color(`38;5;${palette[i % palette.length]}`, ch)).join("");
};

const logo = [
  "    ____  ____  __           _____                     ",
  "   / __ \\/ __ \\/ /_  _______/ ___/__  ______  _____    ",
  "  / /_/ / /_/ / / / / / ___/\\__ \\/ / / / __ \\/ ___/    ",
  " / ____/ ____/ / /_/ (__  )___/ / /_/ / / / / /__      ",
  "/_/   /_/   /_/\\__,_/____/____/\\__, /_/ /_/\\___/      ",
  "                              /____/                    ",
];

const width = 60;
const line = (s, colorFn = (x) => x) => {
  const visibleLen = s.replace(/\u001b\[[0-9;]*m/g, "").length;
  const pad = Math.max(0, width - visibleLen);
  return `  ${cyan("│")} ${colorFn(s)}${" ".repeat(pad)} ${cyan("│")}`;
};

console.log();
console.log("  " + cyan("╭" + "─".repeat(width + 2) + "╮"));
console.log(line(""));
for (const row of logo) console.log(line(grad(row)));
console.log(line(""));
console.log(line("            AI Configuration Sync Tool            ", bold));
console.log(line(""));
console.log(line("      " + mag("Hello from ") + bold(yel("Khalil")) + mag(" @ ") + bold(yel("Masterteam")) + "      "));
console.log(line(""));
console.log(line("  " + dim("One source → many targets → safer PPlus syncs   ")));
console.log(line("  " + dim("Powered by Claude · PGlite · Next.js 15          ")));
if (subtitle) {
  console.log(line(""));
  console.log(line("  " + grn("▸ " + subtitle + " ".repeat(Math.max(0, 50 - subtitle.length)))));
}
console.log(line(""));
console.log("  " + cyan("╰" + "─".repeat(width + 2) + "╯"));
console.log();
