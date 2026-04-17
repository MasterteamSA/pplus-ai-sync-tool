import { NextResponse } from "next/server";
import { AiClient } from "@pplus-sync/ai";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Smoke-test: asks the Agent SDK (backed by the local `claude` CLI) to do a
 * tiny proposeMapping. Confirms both that the CLI is installed AND that the
 * current user's subscription/API key works — no ANTHROPIC_API_KEY needed.
 */
export async function GET() {
  const t0 = Date.now();
  try {
    const ai = new AiClient({ model: process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5" });
    const proposals = await ai.proposeMapping([], {
      kind: "level",
      unmatchedSource: [{ id: "s1", name: "Site" }],
      unmatchedTarget: [{ id: "t1", name: "Facility" }],
      hint: "The org renamed Sites to Facilities last quarter.",
    });
    return NextResponse.json({
      ok: true,
      ms: Date.now() - t0,
      proposals,
      note: "Agent SDK reached the local claude CLI successfully.",
    });
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        ms: Date.now() - t0,
        error: (e as Error).message,
        hint: "Make sure `claude` is installed and you are signed in (`claude` once in a terminal).",
      },
      { status: 500 },
    );
  }
}
