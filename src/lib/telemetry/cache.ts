import type { OrbitalState, ISSTelemetry, SolarActivity, ISSEvent, DockedSpacecraft } from "../types";
import type { CrewRoster } from "../pollers/crew-poller";

export class TelemetryCache {
  orbital: OrbitalState | null = null;
  telemetry: ISSTelemetry | null = null;
  solar: SolarActivity | null = null;
  activeEvent: ISSEvent | null = null;
  crew: CrewRoster | null = null;
  docking: DockedSpacecraft[] | null = null;
  visitorCount = 0;

  /** Full payload sent on initial connect */
  getPayload() {
    return {
      orbital: this.orbital,
      telemetry: this.telemetry,
      solar: this.solar,
      activeEvent: this.activeEvent,
      crew: this.crew,
      docking: this.docking,
      visitorCount: this.visitorCount,
    };
  }

  /**
   * Lightweight payload sent every second (no crew/solar/docking — those ride
   * their own SSE events). activeEvent IS included so already-connected clients
   * see event transitions live, not only on reconnect.
   */
  getTickPayload() {
    return {
      orbital: this.orbital,
      telemetry: this.telemetry,
      activeEvent: this.activeEvent,
      visitorCount: this.visitorCount,
    };
  }
}
