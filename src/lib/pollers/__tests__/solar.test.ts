/**
 * Unit tests for the NOAA SWPC space weather classification functions.
 * These tests cover pure logic only — no network calls are made.
 */

import { describe, it, expect, jest, afterEach } from "@jest/globals";
import {
  classifyKp,
  classifyXray,
  classifyRadiationRisk,
  pollSolarActivity,
} from "../solar";

// ─── classifyKp ──────────────────────────────────────────────────────────────

describe("classifyKp", () => {
  it('returns "Quiet" for kp < 4', () => {
    expect(classifyKp(0)).toBe("Quiet");
    expect(classifyKp(1)).toBe("Quiet");
    expect(classifyKp(3.9)).toBe("Quiet");
  });

  it('returns "Active" for kp >= 4 and < 5', () => {
    expect(classifyKp(4)).toBe("Active");
    expect(classifyKp(4.5)).toBe("Active");
    expect(classifyKp(4.99)).toBe("Active");
  });

  it('returns "Storm" for kp >= 5 and < 7', () => {
    expect(classifyKp(5)).toBe("Storm");
    expect(classifyKp(6)).toBe("Storm");
    expect(classifyKp(6.99)).toBe("Storm");
  });

  it('returns "Severe Storm" for kp >= 7', () => {
    expect(classifyKp(7)).toBe("Severe Storm");
    expect(classifyKp(8)).toBe("Severe Storm");
    expect(classifyKp(9)).toBe("Severe Storm");
  });
});

// ─── classifyXray ────────────────────────────────────────────────────────────

describe("classifyXray", () => {
  it('returns "A" for flux < 1e-7', () => {
    expect(classifyXray(0)).toBe("A");
    expect(classifyXray(1e-8)).toBe("A");
    expect(classifyXray(9.99e-8)).toBe("A");
  });

  it('returns "B" for flux in [1e-7, 1e-6)', () => {
    expect(classifyXray(1e-7)).toBe("B");
    expect(classifyXray(5e-7)).toBe("B");
    expect(classifyXray(9.99e-7)).toBe("B");
  });

  it('returns "C" for flux in [1e-6, 1e-5)', () => {
    expect(classifyXray(1e-6)).toBe("C");
    expect(classifyXray(5e-6)).toBe("C");
    expect(classifyXray(9.99e-6)).toBe("C");
  });

  it('returns "M" for flux in [1e-5, 1e-4)', () => {
    expect(classifyXray(1e-5)).toBe("M");
    expect(classifyXray(5e-5)).toBe("M");
    expect(classifyXray(9.99e-5)).toBe("M");
  });

  it('returns "X" for flux >= 1e-4', () => {
    expect(classifyXray(1e-4)).toBe("X");
    expect(classifyXray(1e-3)).toBe("X");
    expect(classifyXray(1)).toBe("X");
  });
});

// ─── classifyRadiationRisk ───────────────────────────────────────────────────

describe("classifyRadiationRisk", () => {
  it('returns "low" when all inputs are below moderate thresholds', () => {
    expect(classifyRadiationRisk(1, 0, 1e-8)).toBe("low");
    expect(classifyRadiationRisk(0, 0, 0)).toBe("low");
  });

  it('returns "moderate" at the moderate threshold boundary (kp >= 4)', () => {
    expect(classifyRadiationRisk(4, 0, 0)).toBe("moderate");
  });

  it('returns "moderate" when proton10MeV >= 1', () => {
    expect(classifyRadiationRisk(0, 1, 0)).toBe("moderate");
  });

  it('returns "moderate" when xrayFlux >= 1e-6', () => {
    expect(classifyRadiationRisk(0, 0, 1e-6)).toBe("moderate");
  });

  it('returns "high" when kp >= 5', () => {
    expect(classifyRadiationRisk(5, 0, 0)).toBe("high");
    expect(classifyRadiationRisk(6, 0, 0)).toBe("high");
  });

  it('returns "high" when proton10MeV >= 10', () => {
    expect(classifyRadiationRisk(0, 10, 0)).toBe("high");
  });

  it('returns "high" when xrayFlux >= 1e-5', () => {
    expect(classifyRadiationRisk(0, 0, 1e-5)).toBe("high");
  });

  it('returns "severe" when kp >= 7', () => {
    expect(classifyRadiationRisk(7, 0, 0)).toBe("severe");
    expect(classifyRadiationRisk(9, 0, 0)).toBe("severe");
  });

  it('returns "severe" when proton10MeV >= 100', () => {
    expect(classifyRadiationRisk(0, 100, 0)).toBe("severe");
    expect(classifyRadiationRisk(0, 500, 0)).toBe("severe");
  });

  it('returns "severe" when xrayFlux >= 1e-4', () => {
    expect(classifyRadiationRisk(0, 0, 1e-4)).toBe("severe");
    expect(classifyRadiationRisk(0, 0, 1e-3)).toBe("severe");
  });

  it("uses the highest triggered risk when multiple thresholds crossed", () => {
    // kp=6 → high, proton=200 → severe → should be severe
    expect(classifyRadiationRisk(6, 200, 0)).toBe("severe");
    // kp=4 → moderate, xray=1e-5 → high → should be high
    expect(classifyRadiationRisk(4, 0, 1e-5)).toBe("high");
  });
});

// ─── pollSolarActivity (network-shape regression) ────────────────────────────

describe("pollSolarActivity", () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  function mockEndpoints(handler: (url: string) => { ok: boolean; status?: number; body?: unknown }) {
    global.fetch = jest.fn((input: string | URL | Request) => {
      const { ok, status = 200, body } = handler(String(input));
      return Promise.resolve({
        ok,
        status,
        json: () => Promise.resolve(body),
      } as Response);
    }) as unknown as typeof fetch;
  }

  it("reads Kp from NOAA's array-of-objects shape (regression: used to always be 0)", async () => {
    mockEndpoints((url) => {
      if (url.includes("planetary-k-index")) {
        return {
          ok: true,
          body: [
            { time_tag: "2026-06-10T00:00:00", Kp: 2, a_running: 7, station_count: 8 },
            { time_tag: "2026-06-10T03:00:00", Kp: 5.33, a_running: 48, station_count: 8 },
          ],
        };
      }
      if (url.includes("xray")) {
        return { ok: true, body: [{ time_tag: "t", flux: 2e-6, energy: "0.1-0.8nm" }] };
      }
      return { ok: true, body: [{ time_tag: "t", flux: 0.5, energy: ">=10 MeV" }] };
    });

    const result = await pollSolarActivity();
    expect(result).not.toBeNull();
    expect(result!.kpIndex).toBeCloseTo(5.33, 2);
    expect(result!.kpLabel).toBe("Storm");
  });

  it("returns null only when all three endpoints fail", async () => {
    mockEndpoints(() => ({ ok: false, status: 503 }));
    expect(await pollSolarActivity()).toBeNull();
  });

  it("degrades to neutral values when one endpoint fails (others still update)", async () => {
    mockEndpoints((url) => {
      if (url.includes("planetary-k-index")) return { ok: false, status: 500 };
      if (url.includes("xray")) return { ok: true, body: [{ time_tag: "t", flux: 5e-5, energy: "0.1-0.8nm" }] };
      return { ok: true, body: [{ time_tag: "t", flux: 12, energy: ">=10 MeV" }] };
    });

    const result = await pollSolarActivity();
    expect(result).not.toBeNull();
    expect(result!.kpIndex).toBe(0); // failed channel → neutral
    expect(result!.xrayClass).toBe("M"); // healthy channel still parsed
    expect(result!.protonFlux10MeV).toBe(12);
  });
});
