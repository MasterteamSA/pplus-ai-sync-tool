import { AiClient } from "@pplus-sync/ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/ai/explain  { ops: DiffOp[] } → streams Claude's plain-English
 * narration of the diff operations. Consumed by the /diff page.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { ops?: unknown[] };
  const ops = Array.isArray(body.ops) ? body.ops : [];

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      try {
        const ai = new AiClient();
        for await (const chunk of ai.explainDiff([], ops)) {
          controller.enqueue(encoder.encode(chunk));
        }
      } catch (e) {
        controller.enqueue(encoder.encode(`\n\n[error] ${(e as Error).message}`));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-cache, no-transform",
    },
  });
}
