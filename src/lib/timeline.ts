/**
 * Crew timeline builder.
 *
 * The ISS crew day runs on GMT/UTC. There is no public machine-readable feed of
 * the exact daily crew task list, so we build the timeline from two real inputs:
 *   1. A representative GMT crew-day routine (sleep / work / exercise / meals),
 *      based on NASA's published daily structure (wake ~06:00, sleep ~21:30 GMT).
 *   2. The actual scheduled ISS events (EVA / docking / maneuver / reboost) from
 *      our events table, overlaid at their real times.
 *
 * This replaces the previous hardcoded sample that never changed. The routine
 * blocks are representative; the overlaid events are real and update with the
 * schedule.
 */

import type { TimelineActivity, ActivityType, ISSEvent } from "@/lib/types";

const DAY_MS = 24 * 60 * 60 * 1000;

/** UTC midnight (ms) for the day containing `ms`. Unix epoch is UTC-aligned. */
export function utcDayStart(ms: number): number {
  return Math.floor(ms / DAY_MS) * DAY_MS;
}

interface TemplateBlock {
  name: string;
  type: ActivityType;
  /** minutes from UTC midnight */
  startMin: number;
  endMin: number;
}

// Representative ISS crew day in GMT (minutes from 00:00 UTC).
const CREW_DAY_TEMPLATE: TemplateBlock[] = [
  { name: "Sleep", type: "sleep", startMin: 0, endMin: 6 * 60 },
  { name: "Post-Sleep & Hygiene", type: "other", startMin: 6 * 60, endMin: 7 * 60 + 30 },
  { name: "Daily Planning Conference", type: "dpc", startMin: 7 * 60 + 30, endMin: 8 * 60 },
  { name: "Work & Science", type: "science", startMin: 8 * 60, endMin: 13 * 60 },
  { name: "Lunch", type: "meal", startMin: 13 * 60, endMin: 14 * 60 },
  { name: "Work & Science", type: "science", startMin: 14 * 60, endMin: 17 * 60 },
  { name: "Exercise", type: "exercise", startMin: 17 * 60, endMin: 19 * 60 },
  { name: "Dinner & Pre-Sleep", type: "meal", startMin: 19 * 60, endMin: 21 * 60 + 30 },
  { name: "Sleep", type: "sleep", startMin: 21 * 60 + 30, endMin: 24 * 60 },
];

const EVENT_TYPE_TO_ACTIVITY: Partial<Record<ISSEvent["type"], ActivityType>> = {
  eva: "eva",
  docking: "maneuver",
  undocking: "maneuver",
  berthing: "maneuver",
  maneuver: "maneuver",
  reboost: "maneuver",
};

/**
 * Build the crew timeline for the UTC day starting at `dayStartUtcMs`, overlaying
 * any scheduled events that intersect that day on top of the routine template.
 */
export function buildDayTimeline(
  dayStartUtcMs: number,
  events: ISSEvent[]
): TimelineActivity[] {
  const dayEnd = dayStartUtcMs + DAY_MS;

  const base: TimelineActivity[] = CREW_DAY_TEMPLATE.map((b) => ({
    name: b.name,
    type: b.type,
    startTime: dayStartUtcMs + b.startMin * 60_000,
    endTime: dayStartUtcMs + b.endMin * 60_000,
  }));

  const overlays: TimelineActivity[] = events
    .filter((e) => e.scheduledStart < dayEnd && e.scheduledEnd > dayStartUtcMs)
    .map((e) => ({
      name: e.title,
      type: EVENT_TYPE_TO_ACTIVITY[e.type] ?? "other",
      // Clamp to the day so a multi-day event renders only its slice.
      startTime: Math.max(e.scheduledStart, dayStartUtcMs),
      endTime: Math.min(e.scheduledEnd, dayEnd),
    }));

  return [...base, ...overlays].sort((a, b) => a.startTime - b.startTime);
}
