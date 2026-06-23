/**
 * NOAA SWPC Space Weather Poller
 * Ported from the Artemis tracker pattern.
 *
 * Fetches geomagnetic Kp index, X-ray flux, and proton flux from NOAA SWPC
 * and derives a crew radiation risk level.
 */

import {
  NOAA_KP_URL,
  NOAA_XRAY_URL,
  NOAA_PROTON_URL,
} from "@/lib/constants";
import type { SolarActivity, RadiationRisk } from "@/lib/types";

// ─── Classification helpers ──────────────────────────────────────────────────

/**
 * Classify a Kp geomagnetic index into a human-readable label.
 * <4 → "Quiet", 4–5 → "Active", 5–7 → "Storm", ≥7 → "Severe Storm"
 */
export function classifyKp(kp: number): string {
  if (kp >= 7) return "Severe Storm";
  if (kp >= 5) return "Storm";
  if (kp >= 4) return "Active";
  return "Quiet";
}

/**
 * Classify an X-ray flux (W/m²) into a GOES solar flare class letter.
 * <1e-7 → "A", <1e-6 → "B", <1e-5 → "C", <1e-4 → "M", else → "X"
 */
export function classifyXray(flux: number): string {
  if (flux < 1e-7) return "A";
  if (flux < 1e-6) return "B";
  if (flux < 1e-5) return "C";
  if (flux < 1e-4) return "M";
  return "X";
}

/**
 * Derive crew radiation risk level from three sensor inputs.
 *
 * @param kp            - Kp geomagnetic index
 * @param proton10MeV   - Proton flux at ≥10 MeV (pfu)
 * @param xrayFlux      - X-ray flux (W/m²)
 * @returns "severe" | "high" | "moderate" | "low"
 */
export function classifyRadiationRisk(
  kp: number,
  proton10MeV: number,
  xrayFlux: number
): RadiationRisk {
  if (kp >= 7 || proton10MeV >= 100 || xrayFlux >= 1e-4) return "severe";
  if (kp >= 5 || proton10MeV >= 10 || xrayFlux >= 1e-5) return "high";
  if (kp >= 4 || proton10MeV >= 1 || xrayFlux >= 1e-6) return "moderate";
  return "low";
}

// ─── Internal NOAA response shapes ───────────────────────────────────────────

// NOAA's planetary K-index product returns an array of objects. (It used to
// return an array-of-arrays with a leading header row; that format is gone, so
// indexing `[1]` silently yielded undefined → Kp always parsed as 0.)
interface KpEntry {
  time_tag: string;
  Kp: number;
  a_running: number;
  station_count: number;
}

interface XrayEntry {
  time_tag: string;
  flux: number;
  energy: string;
}

interface ProtonEntry {
  time_tag: string;
  flux: number;
  energy: string;
}

// ─── Poller ──────────────────────────────────────────────────────────────────

/** Fetch + parse one NOAA JSON endpoint. Returns null if the request errored,
 *  the response was not OK (e.g. a 5xx HTML error page), or the body was not
 *  valid JSON — so one bad endpoint cannot reject the whole batch. */
async function fetchNoaaJson<T>(
  url: string,
  signal: AbortSignal
): Promise<T | null> {
  try {
    const res = await fetch(url, { signal });
    if (!res.ok) {
      console.warn(`[solar] ${new URL(url).hostname} returned ${res.status}`);
      return null;
    }
    return (await res.json()) as T;
  } catch (err) {
    if ((err as Error).name !== "AbortError") {
      console.warn(`[solar] fetch failed for ${url}:`, (err as Error).message ?? err);
    }
    return null;
  }
}

/**
 * Fetch space weather data from three NOAA SWPC endpoints.
 *
 * Each endpoint is fetched independently: a single outage degrades only that
 * channel (which falls back to a neutral 0) rather than wiping the whole
 * snapshot. Returns null only if ALL three fail, so the caller keeps its last
 * good data instead of clobbering it with all-zero readings.
 */
export async function pollSolarActivity(): Promise<SolarActivity | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const [kpData, xrayData, protonData] = await Promise.all([
      fetchNoaaJson<KpEntry[]>(NOAA_KP_URL, controller.signal),
      fetchNoaaJson<XrayEntry[]>(NOAA_XRAY_URL, controller.signal),
      fetchNoaaJson<ProtonEntry[]>(NOAA_PROTON_URL, controller.signal),
    ]);

    if (!kpData && !xrayData && !protonData) return null;

    if (!kpData || !xrayData || !protonData) {
      console.warn(
        `[solar] Partial space-weather data (kp=${!!kpData}, xray=${!!xrayData}, proton=${!!protonData}); missing channels default to 0`
      );
    }

    // ── Kp: last entry's Kp value (array-of-objects shape) ─────────────────
    const kpIndex = Array.isArray(kpData) ? kpData.at(-1)?.Kp ?? 0 : 0;

    // ── X-ray: last entry with flux (short-wavelength 0.1–0.8 nm band) ───
    const xrayFlux =
      (xrayData ?? [])
        .filter((e) => e.energy === "0.1-0.8nm" && typeof e.flux === "number")
        .at(-1)?.flux ?? 0;

    // ── Proton: separate channels by energy band ──────────────────────────
    const protonFlux1MeV =
      (protonData ?? []).filter((e) => e.energy === ">=1 MeV").at(-1)?.flux ?? 0;
    const protonFlux10MeV =
      (protonData ?? []).filter((e) => e.energy === ">=10 MeV").at(-1)?.flux ?? 0;
    const protonFlux100MeV =
      (protonData ?? []).filter((e) => e.energy === ">=100 MeV").at(-1)?.flux ?? 0;

    const kpLabel = classifyKp(kpIndex);
    const xrayClass = classifyXray(xrayFlux);
    const radiationRisk = classifyRadiationRisk(kpIndex, protonFlux10MeV, xrayFlux);

    return {
      timestamp: Date.now(),
      kpIndex,
      kpLabel,
      xrayFlux,
      xrayClass,
      protonFlux1MeV,
      protonFlux10MeV,
      protonFlux100MeV,
      radiationRisk,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
