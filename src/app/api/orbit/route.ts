export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getCurrentTle, pollTle } from "@/lib/pollers/tle-poller";
import { propagateFromTle } from "@/lib/pollers/sgp4-propagator";

export async function GET() {
  // Lazily fetch the TLE if the background pollers haven't loaded it yet, so a
  // direct hit on a cold server (before any SSE client connects) self-heals
  // instead of returning 503.
  let tle = getCurrentTle();
  if (!tle) tle = await pollTle();
  if (!tle) {
    return NextResponse.json(
      { error: "TLE data not yet available" },
      { status: 503 }
    );
  }

  const orbital = propagateFromTle(tle, new Date());
  if (!orbital) {
    return NextResponse.json(
      { error: "Could not propagate orbital state from current TLE" },
      { status: 500 }
    );
  }

  return NextResponse.json(orbital);
}
