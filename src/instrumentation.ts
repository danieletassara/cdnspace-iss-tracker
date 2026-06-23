/**
 * Next.js instrumentation hook — runs once when a server instance starts.
 *
 * Arms the in-process telemetry pollers (TLE, SGP4, Lightstreamer, solar,
 * schedule/events, crew, docking, archiving, prune) at server boot so the data
 * stays fresh even before the first client opens the SSE stream. Previously the
 * pollers only started on the first GET to /api/telemetry/stream, so a deployed
 * process that hadn't been hit (or restarted) would serve frozen crew/event
 * data.
 */
export async function register() {
  // Only the Node.js runtime can run the pollers (timers, mysql2, sockets).
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { ensurePollers } = await import("@/lib/telemetry/background");
    ensurePollers();
  }
}
