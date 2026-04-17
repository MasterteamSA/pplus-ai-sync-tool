import { NextResponse } from "next/server";
import { z } from "zod";
import { alignKeys, type KeyAlignmentDecision } from "@pplus-sync/core";
import { KeyAgent } from "@pplus-sync/ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const propSchema = z.object({
  key: z.string().min(1),
  name: z.string().optional(),
  type: z.string().optional(),
  formula: z.string().nullable().optional(),
});

const bodySchema = z.object({
  source: z.array(propSchema).min(1),
  target: z.array(propSchema).min(1),
  sourceLevelNames: z.array(z.string()).default([]),
  targetLevelNames: z.array(z.string()).default([]),
  levelMap: z.record(z.string(), z.string()).default({}),
  sourceFormulas: z.array(z.string()).optional(),
  targetFormulas: z.array(z.string()).optional(),
  useAi: z.boolean().default(true),
  hint: z.string().optional(),
});

/**
 * POST /api/ai/align
 * Deterministic alignment first, then Claude resolves the residual.
 * Returns decisions with method + confidence + reason for every sourceKey.
 */
export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.flatten() }, { status: 400 });
  }
  const input = parsed.data;
  const t0 = Date.now();

  const det = alignKeys({
    source: input.source,
    target: input.target,
    sourceLevelNames: input.sourceLevelNames,
    targetLevelNames: input.targetLevelNames,
    levelMap: input.levelMap,
    ...(input.sourceFormulas ? { sourceFormulas: input.sourceFormulas } : {}),
    ...(input.targetFormulas ? { targetFormulas: input.targetFormulas } : {}),
  });

  let aiDecisions: KeyAlignmentDecision[] = [];
  let aiMs = 0;
  if (input.useAi && det.aiQueue.length > 0) {
    try {
      const aiStart = Date.now();
      const agent = new KeyAgent();
      const results = await agent.resolve(det.aiQueue, {
        levelMap: input.levelMap,
        sourceKeys: input.source.map((p) => ({
          key: p.key,
          ...(p.name ? { name: p.name } : {}),
          ...(p.type ? { type: p.type } : {}),
          ...(p.formula ? { formulas: [p.formula] } : {}),
        })),
        targetKeys: input.target.map((p) => ({
          key: p.key,
          ...(p.name ? { name: p.name } : {}),
          ...(p.type ? { type: p.type } : {}),
          ...(p.formula ? { formulas: [p.formula] } : {}),
        })),
        ...(input.hint ? { hint: input.hint } : {}),
      });
      aiMs = Date.now() - aiStart;
      aiDecisions = results.map((r) => ({
        sourceKey: r.sourceKey,
        targetKey: r.targetKey,
        method: r.targetKey ? "ai" : "unresolved",
        confidence: r.confidence,
        reason: r.reason,
      }));
    } catch (e) {
      return NextResponse.json(
        {
          ok: false,
          error: `AI resolution failed: ${(e as Error).message}`,
          det,
        },
        { status: 502 },
      );
    }
  }

  const combined = [
    ...det.decisions,
    ...aiDecisions,
    ...(input.useAi
      ? []
      : det.aiQueue.map((q) => ({
          sourceKey: q.sourceKey,
          targetKey: null,
          method: "unresolved" as const,
          confidence: 0,
          reason: q.reason,
        }))),
  ];
  const byMethod = combined.reduce<Record<string, number>>((acc, d) => {
    acc[d.method] = (acc[d.method] ?? 0) + 1;
    return acc;
  }, {});

  const usedTargetKeys = new Set(
    combined.map((d) => d.targetKey).filter((k): k is string => k !== null),
  );
  const unusedTargetKeys = input.target
    .map((t) => t.key)
    .filter((k) => !usedTargetKeys.has(k));

  return NextResponse.json({
    ok: true,
    totalMs: Date.now() - t0,
    deterministicCount: det.decisions.length,
    aiCount: aiDecisions.filter((d) => d.targetKey).length,
    unresolvedCount: combined.filter((d) => !d.targetKey).length,
    aiMs,
    byMethod,
    decisions: combined,
    unusedTargetKeys,
  });
}
