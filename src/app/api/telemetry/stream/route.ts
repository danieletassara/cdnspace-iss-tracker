export const dynamic = "force-dynamic";

import { SseManager } from "@/lib/telemetry/sse-manager";
import { cache, sseManager, ensurePollers } from "@/lib/telemetry/background";
import { incrementPageViews } from "@/lib/db";

export function GET(request: Request) {
  ensurePollers();

  const encoder = new TextEncoder();
  let removeClient: (() => void) | null = null;

  const cleanup = () => {
    if (removeClient) {
      removeClient();
      removeClient = null;
    }
  };

  const stream = new ReadableStream({
    start(controller) {
      removeClient = sseManager.addClient(controller);

      // Increment page view counter on each new connection
      incrementPageViews().catch((err) => {
        console.error("[stream] Page view increment failed:", err.message ?? err);
      });

      // Send the current cached payload immediately on connect
      const initial = cache.getPayload();
      try {
        controller.enqueue(
          encoder.encode(SseManager.encodeEvent("telemetry", initial))
        );
      } catch {
        // Client already disconnected mid-handshake — remove it now rather
        // than waiting for a later broadcast to notice the dead controller.
        cleanup();
      }
    },
    // cancel() is the spec-defined teardown hook the runtime calls when the
    // client disconnects. (The value returned from start() is NOT a cleanup
    // hook, so the previous implementation never removed clients on disconnect,
    // leaking references and inflating the visitor count.)
    cancel() {
      cleanup();
    },
  });

  // Belt-and-suspenders: also clean up if the underlying request is aborted
  // (connection reset) before/independent of stream cancellation.
  request.signal.addEventListener("abort", cleanup);

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
