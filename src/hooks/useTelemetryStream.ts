"use client";

import { useState, useEffect, useRef } from "react";
import type { OrbitalState, ISSTelemetry, SolarActivity, ISSEvent, CrewMember, DockedSpacecraft } from "@/lib/types";

export interface CrewRoster {
  expedition: number;
  crew: CrewMember[];
}

interface TelemetryStreamState {
  orbital: OrbitalState | null;
  telemetry: ISSTelemetry | null;
  solar: SolarActivity | null;
  activeEvent: ISSEvent | null;
  crew: CrewRoster | null;
  docking: DockedSpacecraft[] | null;
  connected: boolean;
  reconnecting: boolean;
  lastUpdate: number | null;
  visitorCount: number;
}

const INITIAL_RECONNECT_DELAY_MS = 1000;
const MAX_RECONNECT_DELAY_MS = 30000;

export function useTelemetryStream(enabled: boolean = true): TelemetryStreamState {
  const [state, setState] = useState<TelemetryStreamState>({
    orbital: null,
    telemetry: null,
    solar: null,
    activeEvent: null,
    crew: null,
    docking: null,
    connected: false,
    reconnecting: false,
    lastUpdate: null,
    visitorCount: 0,
  });

  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stableTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const unmountedRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;

    unmountedRef.current = false;

    function connect() {
      if (unmountedRef.current) return;

      const es = new EventSource("/api/telemetry/stream");
      esRef.current = es;

      es.addEventListener("open", () => {
        if (unmountedRef.current) return;
        setState((prev) => ({ ...prev, connected: true, reconnecting: false }));
        // Reset the backoff only once the connection has proven stable. A
        // server that accepts the connection then immediately errors would
        // otherwise reset the counter to 0 on every "open" and produce a tight
        // 1s reconnect loop instead of backing off.
        if (stableTimerRef.current !== null) clearTimeout(stableTimerRef.current);
        stableTimerRef.current = setTimeout(() => {
          retryCountRef.current = 0;
        }, 10_000);
      });

      es.addEventListener("telemetry", (e: MessageEvent) => {
        if (unmountedRef.current) return;
        try {
          const data = JSON.parse(e.data as string) as Partial<TelemetryStreamState>;
          setState((prev) => ({
            ...prev,
            orbital: data.orbital ?? prev.orbital,
            telemetry: data.telemetry ?? prev.telemetry,
            solar: data.solar ?? prev.solar,
            activeEvent: data.activeEvent !== undefined ? data.activeEvent : prev.activeEvent,
            crew: data.crew ?? prev.crew,
            docking: data.docking ?? prev.docking,
            visitorCount: data.visitorCount ?? prev.visitorCount,
            lastUpdate: Date.now(),
          }));
        } catch {
          // ignore malformed events
        }
      });

      es.addEventListener("solar", (e: MessageEvent) => {
        if (unmountedRef.current) return;
        try {
          const solar = JSON.parse(e.data as string) as SolarActivity;
          setState((prev) => ({ ...prev, solar: solar ?? prev.solar }));
        } catch {
          // ignore malformed events
        }
      });

      es.addEventListener("visitors", (e: MessageEvent) => {
        if (unmountedRef.current) return;
        try {
          const visitorCount = JSON.parse(e.data as string) as number;
          setState((prev) => ({ ...prev, visitorCount }));
        } catch {
          // ignore malformed events
        }
      });

      es.addEventListener("crew", (e: MessageEvent) => {
        if (unmountedRef.current) return;
        try {
          const crew = JSON.parse(e.data as string) as CrewRoster;
          setState((prev) => ({ ...prev, crew }));
        } catch {
          // ignore malformed events
        }
      });

      es.addEventListener("docking", (e: MessageEvent) => {
        if (unmountedRef.current) return;
        try {
          const docking = JSON.parse(e.data as string) as DockedSpacecraft[];
          setState((prev) => ({ ...prev, docking }));
        } catch {
          // ignore malformed events
        }
      });

      es.addEventListener("error", () => {
        if (unmountedRef.current) return;

        es.close();
        esRef.current = null;
        if (stableTimerRef.current !== null) {
          clearTimeout(stableTimerRef.current);
          stableTimerRef.current = null;
        }

        setState((prev) => ({
          ...prev,
          connected: false,
          reconnecting: true,
        }));

        const base = Math.min(
          INITIAL_RECONNECT_DELAY_MS * Math.pow(2, retryCountRef.current),
          MAX_RECONNECT_DELAY_MS
        );
        // Randomized jitter (50–100% of base) so many clients dropped by the
        // same server blip don't reconnect in lockstep and stampede the route.
        const delay = base * (0.5 + Math.random() * 0.5);
        retryCountRef.current += 1;

        retryTimerRef.current = setTimeout(() => {
          if (!unmountedRef.current) {
            connect();
          }
        }, delay);
      });
    }

    connect();

    return () => {
      unmountedRef.current = true;
      if (retryTimerRef.current !== null) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      if (stableTimerRef.current !== null) {
        clearTimeout(stableTimerRef.current);
        stableTimerRef.current = null;
      }
      if (esRef.current !== null) {
        esRef.current.close();
        esRef.current = null;
      }
    };
  }, [enabled]);

  return state;
}
