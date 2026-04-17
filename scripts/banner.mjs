#!/usr/bin/env node
/**
 * PPlus AI Sync Tool — terminal banner.
 * Usage:   node scripts/banner.mjs [subtitle]
 *
 * 24-bit truecolor gradient logo with an ANSI-shadow block font,
 * framed in a rounded box with a soft cyan border.
 */

const subtitle = process.argv.slice(2).join(" ").trim();
const isTTY = process.stdout.isTTY === true;

// ── ANSI helpers ─────────────────────────────────────────────────────
const esc = (c, s) => (isTTY ? `\u001b[${c}m${s}\u001b[0m` : s);
const rgb = (r, g, b, s) => (isTTY ? `\u001b[38;2;${r};${g};${b}m${s}\u001b[0m` : s);
const bold = (s) => esc("1", s);
const dim = (s) => esc("2", s);
const reset = () => (isTTY ? "\u001b[0m" : "");

// Cyan → Blue → Violet → Magenta → Gold gradient stops.
const STOPS = [
  [0x7d, 0xf9, 0xff], // cyan
  [0x4f, 0x8c, 0xff], // blue
  [0x6a, 0x5a, 0xcd], // slate-blue
  [0xc4, 0x98, 0x4f], // gold (Masterteam)
  [0xff, 0x7a, 0x45], // orange accent
];
function lerp(a, b, t) {
  return Math.round(a + (b - a) * t);
}
function grad(t) {
  const tt = Math.max(0, Math.min(1, t));
  const segs = STOPS.length - 1;
  const seg = Math.min(segs - 1, Math.floor(tt * segs));
  const local = tt * segs - seg;
  const a = STOPS[seg], b = STOPS[seg + 1];
  return [lerp(a[0], b[0], local), lerp(a[1], b[1], local), lerp(a[2], b[2], local)];
}

// Color a string character-by-character across the gradient.
function gradientLine(s) {
  if (!isTTY) return s;
  const chars = [...s];
  const nonSpace = chars.filter((c) => c !== " ").length;
  let seen = 0;
  let out = "";
  for (const c of chars) {
    if (c === " ") { out += c; continue; }
    const t = nonSpace <= 1 ? 0 : seen / (nonSpace - 1);
    const [r, g, b] = grad(t);
    out += rgb(r, g, b, c);
    seen++;
  }
  return out;
}

// ── Logo ─────────────────────────────────────────────────────────────
// ANSI Shadow block font — "PPLUS".
const LOGO = [
  "██████╗ ██████╗ ██╗     ██╗   ██╗███████╗",
  "██╔══██╗██╔══██╗██║     ██║   ██║██╔════╝",
  "██████╔╝██████╔╝██║     ██║   ██║███████╗",
  "██╔═══╝ ██╔═══╝ ██║     ██║   ██║╚════██║",
  "██║     ██║     ███████╗╚██████╔╝███████║",
  "╚═╝     ╚═╝     ╚══════╝ ╚═════╝ ╚══════╝",
];

// ── Frame ────────────────────────────────────────────────────────────
const INNER = 64; // visible inner width of the frame
const PAD_L = 2;  // left padding inside the frame

const stripAnsi = (s) => s.replace(/\u001b\[[0-9;]*m/g, "");
const visibleLen = (s) => [...stripAnsi(s)].length;

const border = (ch) => rgb(102, 176, 208, ch);
const tl = border("╭");
const tr = border("╮");
const bl = border("╰");
const br = border("╯");
const h = border("─");
const v = border("│");

function line(content = "") {
  const pad = Math.max(0, INNER - visibleLen(content));
  return ` ${v} ${" ".repeat(PAD_L)}${content}${" ".repeat(pad - PAD_L)} ${v}`;
}

// ── Render ───────────────────────────────────────────────────────────
function render() {
  const lines = [];
  lines.push("");
  lines.push(` ${tl}${h.repeat(INNER + 2)}${tr}`);
  lines.push(line(""));

  for (const row of LOGO) lines.push(line(gradientLine(row)));

  lines.push(line(""));
  const tagline = "A I   C O N F I G   S Y N C   T O O L";
  const padTag = Math.floor((INNER - PAD_L - visibleLen(tagline)) / 2);
  lines.push(line(" ".repeat(padTag) + bold(rgb(196, 152, 79, tagline))));
  lines.push(line(""));

  const divider = border("·─·─·─·─·─·─·─·─·─·─·─·─·─·─·─·─·─·─·─·");
  const padDiv = Math.floor((INNER - PAD_L - visibleLen(divider)) / 2);
  lines.push(line(" ".repeat(padDiv) + divider));

  lines.push(line(""));
  const hello = `${dim("Hello from")} ${bold(rgb(255, 122, 69, "Khalil"))} ${dim("@")} ${bold(rgb(196, 152, 79, "Masterteam"))}`;
  const helloPad = Math.floor((INNER - PAD_L - visibleLen(hello)) / 2);
  lines.push(line(" ".repeat(helloPad) + hello));

  lines.push(line(""));
  lines.push(line(dim("One source → many targets → safer PPlus syncs")));
  lines.push(line(dim("Powered by ") + rgb(153, 204, 255, "Claude") + dim(" · ") + rgb(153, 204, 255, "PGlite") + dim(" · ") + rgb(153, 204, 255, "Next.js 15")));

  if (subtitle) {
    lines.push(line(""));
    lines.push(line(bold(rgb(125, 249, 255, "▸ ")) + bold(subtitle)));
  }

  lines.push(line(""));
  lines.push(` ${bl}${h.repeat(INNER + 2)}${br}`);
  lines.push("");
  return lines.join("\n");
}

process.stdout.write(render() + reset());
