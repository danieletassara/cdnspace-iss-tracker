export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getEventsForDay } from "@/lib/db";
import { buildDayTimeline, utcDayStart } from "@/lib/timeline";

/**
 * Crew timeline for the current GMT day: a representative ISS routine with the
 * day's real scheduled events overlaid. Computed on demand so it reflects the
 * latest events and the current time without a separate poller.
 */
export async function GET() {
  const dayStart = utcDayStart(Date.now());
  const dayEnd = dayStart + 24 * 60 * 60 * 1000;

  let events: Awaited<ReturnType<typeof getEventsForDay>> = [];
  try {
    events = await getEventsForDay(dayStart, dayEnd);
  } catch (err) {
    console.error("[timeline] event query failed, using routine only:", err);
  }

  const activities = buildDayTimeline(dayStart, events);
  return NextResponse.json({ dayStart, activities });
}
