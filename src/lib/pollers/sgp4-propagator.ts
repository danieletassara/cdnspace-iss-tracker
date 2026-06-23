/**
 * SGP4 Propagator
 *
 * Converts a TLE into a full OrbitalState at an arbitrary point in time using
 * the satellite.js SGP4 implementation.  Also computes orbital elements parsed
 * directly from TLE line 2, and a simplified sunlight / shadow determination.
 */

import {
  twoline2satrec,
  propagate,
  gstime,
  eciToGeodetic,
  eciToEcf,
  degreesLat,
  degreesLong,
  sunPos,
  shadowFraction,
} from "satellite.js";

import { EARTH_RADIUS_KM } from "@/lib/constants";
import type { OrbitalState } from "@/lib/types";
import type { TleData } from "./tle-poller";

// Re-export so consumers can import from a single place if needed.
export type { TleData };

/** GM of Earth (km³/s²) used for Kepler's third law */
const GM_KM3_S2 = 398600.4418;

// ─── Public API ──────────────────────────────────────────────────────────────

// Cache for sunrise/sunset prediction. The expensive orbit scan runs at most
// every 10s, but we cache the ABSOLUTE transition timestamps (not relative
// "seconds until") so the countdown returned on every 1s tick keeps
// decrementing accurately between scans instead of sticking at a stale value.
let lastSunlightComputeMs = 0;
let cachedSunriseAtMs: number | null = null;
let cachedSunsetAtMs: number | null = null;

/**
 * Propagate an ISS TLE to a given date and return a complete OrbitalState.
 * Returns null if satellite.js cannot propagate (e.g. decayed or bad TLE).
 */
export function propagateFromTle(tle: TleData, date: Date): OrbitalState | null {
  const satrec = twoline2satrec(tle.line1, tle.line2);
  const result = propagate(satrec, date);

  const position = result.position;
  const velocity = result.velocity;

  if (
    !position ||
    typeof position === "boolean" ||
    !velocity ||
    typeof velocity === "boolean" ||
    isNaN((position as { x: number }).x) ||
    isNaN((velocity as { x: number }).x)
  ) {
    return null;
  }

  // ── Geodetic position ─────────────────────────────────────────────────────
  const gmst = gstime(date);
  const geodetic = eciToGeodetic(position, gmst);
  const lat = degreesLat(geodetic.latitude);
  const lon = degreesLong(geodetic.longitude);
  const altitude = geodetic.height; // km

  // ── Velocity ──────────────────────────────────────────────────────────────
  const velocityKms = Math.sqrt(
    velocity.x ** 2 + velocity.y ** 2 + velocity.z ** 2
  );
  const speedKmH = velocityKms * 3600;

  // ── Orbital elements from TLE line 2 ─────────────────────────────────────
  // TLE line 2 column positions (0-indexed):
  //   9–16   inclination (degrees)
  //  26–32   eccentricity (decimal point assumed before digits)
  //  52–62   mean motion (revolutions per day)
  const inclination = parseFloat(tle.line2.substring(8, 16).trim());
  const eccentricity = parseFloat("0." + tle.line2.substring(26, 33).trim());
  const meanMotionRevPerDay = parseFloat(tle.line2.substring(52, 63).trim());

  // Revolution number — use NORAD's own revolution-at-epoch counter from
  // TLE line 2 (columns 64–68, 0-indexed substring 63–68) as the base, then
  // add whole revolutions elapsed since the TLE epoch. This tracks the true
  // orbit count. (Extrapolating from the 1998 launch date over-counted by
  // ~3x because mean motion has changed with reboosts/decay over the years.)
  const revAtEpoch = parseInt(tle.line2.substring(63, 68).trim(), 10) || 0;
  const epochMs = tleEpochToMs(tle.line1);
  const elapsedRevs =
    Math.max(0, (date.getTime() - epochMs) / 86_400_000) * meanMotionRevPerDay;
  const revolutionNumber = revAtEpoch + Math.floor(elapsedRevs);

  // ── Period & semi-major axis ──────────────────────────────────────────────
  const periodSeconds = 86400 / meanMotionRevPerDay;
  const periodMinutes = periodSeconds / 60;

  // Kepler's third law: a³ = GM * T² / (4π²)
  const semiMajorAxisKm =
    Math.cbrt((GM_KM3_S2 * periodSeconds ** 2) / (4 * Math.PI ** 2));

  // Apsis altitudes are GEOCENTRIC — height above Earth's mean radius
  // (EARTH_RADIUS_KM = 6371). This is intentionally a different reference
  // surface than the live `altitude` above (height above the WGS-84 ellipsoid
  // from eciToGeodetic), so the two can differ by up to ~7 km: the apsides
  // describe the orbit's spherical mean shape, not a geodetic height at a
  // specific latitude.
  const apoapsis = semiMajorAxisKm * (1 + eccentricity) - EARTH_RADIUS_KM;
  const periapsis = semiMajorAxisKm * (1 - eccentricity) - EARTH_RADIUS_KM;

  // ── Sunlight determination ────────────────────────────────────────────────
  const jd = dateToJulian(date);
  const { rsun } = sunPos(jd);
  const fraction = shadowFraction(rsun, position);
  const isInSunlight = fraction < 0.5;

  // ── Beta angle ────────────────────────────────────────────────────────────
  // Beta angle = angle between the orbital plane and the Sun-Earth vector.
  // Formula: β = arcsin(cos(sunDec) * sin(RAAN - sunRA) * sin(inc) + sin(sunDec) * cos(inc))
  //
  // We derive RAAN from TLE line 2 (columns 17–24, 0-indexed) and inclination
  // is already parsed above. Sun position comes from satellite.js sunPos().
  //
  // rsun is in ECI (km). Convert to unit vector to get RA/Dec.
  const raan = parseFloat(tle.line2.substring(17, 25).trim()) * (Math.PI / 180);
  const incRad = inclination * (Math.PI / 180);
  const sunMag = Math.sqrt(rsun.x ** 2 + rsun.y ** 2 + rsun.z ** 2);
  const sunDec = Math.asin(rsun.z / sunMag);          // radians
  const sunRA  = Math.atan2(rsun.y, rsun.x);           // radians
  const betaRad = Math.asin(
    Math.cos(sunDec) * Math.sin(raan - sunRA) * Math.sin(incRad) +
    Math.sin(sunDec) * Math.cos(incRad)
  );
  const betaAngle = betaRad * (180 / Math.PI);

  // ── Sunrise/Sunset prediction ──────────────────────────────────────────────
  // Step forward in 15-second increments up to a full orbit to find the next
  // sunlight transition. The scan only runs every 10s, but we store the
  // ABSOLUTE transition time and derive the remaining seconds on every call,
  // so the countdown decrements smoothly between scans.
  const now = Date.now();
  const shouldRecompute = now - lastSunlightComputeMs > 10_000;
  if (shouldRecompute) {
    lastSunlightComputeMs = now;
    cachedSunriseAtMs = null;
    cachedSunsetAtMs = null;

    const STEP_SEC = 15;
    const MAX_LOOK_AHEAD_SEC = 95 * 60; // Full orbit to guarantee a transition if one exists
    let stepsChecked = 0;
    let lastFraction = fraction;

    for (let dt = STEP_SEC; dt <= MAX_LOOK_AHEAD_SEC; dt += STEP_SEC) {
      const futureDate = new Date(date.getTime() + dt * 1000);
      const futureResult = propagate(satrec, futureDate);
      if (!futureResult.position || typeof futureResult.position === "boolean") break;

      const futureJd = dateToJulian(futureDate);
      const futureSun = sunPos(futureJd);
      const futureFraction = shadowFraction(futureSun.rsun, futureResult.position);
      const futureInSunlight = futureFraction < 0.5;
      stepsChecked++;
      lastFraction = futureFraction;

      if (isInSunlight && !futureInSunlight) {
        cachedSunsetAtMs = date.getTime() + dt * 1000;
        break;
      }
      if (!isInSunlight && futureInSunlight) {
        cachedSunriseAtMs = date.getTime() + dt * 1000;
        break;
      }
    }

    if (stepsChecked > 0 && cachedSunriseAtMs === null && cachedSunsetAtMs === null) {
      // Log once if we scanned the full range without finding a transition
      console.log(`[sgp4] Sunlight scan: ${stepsChecked} steps, no transition found. isInSunlight=${isInSunlight}, lastFraction=${lastFraction.toFixed(4)}, beta=${betaAngle.toFixed(1)}°`);
    }
  }

  // Derive remaining seconds from the cached absolute transition times so the
  // countdown stays current on every tick (clamped at 0 until the next scan).
  const sunriseIn =
    cachedSunriseAtMs != null
      ? Math.max(0, Math.round((cachedSunriseAtMs - date.getTime()) / 1000))
      : null;
  const sunsetIn =
    cachedSunsetAtMs != null
      ? Math.max(0, Math.round((cachedSunsetAtMs - date.getTime()) / 1000))
      : null;

  return {
    timestamp: date.getTime(),
    lat,
    lon,
    altitude,
    velocity: velocityKms,
    speedKmH,
    period: periodMinutes,
    inclination,
    eccentricity,
    apoapsis,
    periapsis,
    revolutionNumber,
    isInSunlight,
    sunriseIn,
    sunsetIn,
    betaAngle,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Convert a JavaScript Date to a Julian Day Number as expected by satellite.js sunPos(). */
function dateToJulian(date: Date): number {
  return date.getTime() / 86400000 + 2440587.5;
}

/**
 * Parse a TLE epoch (line 1, columns 19–32: "YYDDD.DDDDDDDD") to a UTC
 * millisecond timestamp. Two-digit years 57–99 map to 1957–1999 and 00–56 to
 * 2000–2056 (the conventional TLE pivot). Used to count revolutions elapsed
 * since the element set's epoch.
 */
function tleEpochToMs(line1: string): number {
  const field = line1.substring(18, 32).trim();
  const yy = parseInt(field.substring(0, 2), 10);
  const year = yy < 57 ? 2000 + yy : 1900 + yy;
  const dayOfYear = parseFloat(field.substring(2)); // 1-based day with fraction
  return Date.UTC(year, 0, 1) + (dayOfYear - 1) * 86_400_000;
}
