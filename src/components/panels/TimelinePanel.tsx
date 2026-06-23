"use client";

import { useState, useEffect } from "react";
import PanelFrame from "@/components/shared/PanelFrame";
import type { ActivityType, TimelineActivity } from "@/lib/types";
import { buildDayTimeline, utcDayStart } from "@/lib/timeline";
import { useLocale } from "@/context/LocaleContext";

const ACTIVITY_COLORS: Record<ActivityType, string> = {
  sleep: "var(--color-activity-sleep)",
  science: "var(--color-activity-science)",
  exercise: "var(--color-activity-exercise)",
  meal: "var(--color-activity-meal)",
  eva: "var(--color-activity-eva)",
  maneuver: "var(--color-activity-maneuver)",
  dpc: "#5c8a8a",
  "off-duty": "var(--color-activity-off-duty)",
  other: "#4a5568",
};

const DAY_MS = 24 * 60 * 60 * 1000;

export default function TimelinePanel() {
  const { t } = useLocale();
  // dayStart/activities are populated client-side (the ISS day is GMT-based and
  // Date.now() in render would risk a hydration mismatch), so SSR renders an
  // empty axis that fills in immediately on mount.
  const [dayStart, setDayStart] = useState<number | null>(null);
  const [activities, setActivities] = useState<TimelineActivity[]>([]);
  const [nowFrac, setNowFrac] = useState<number | null>(null);

  // Load the live timeline (representative GMT routine + real scheduled events)
  // and refresh every 5 minutes so it stays current as events change.
  useEffect(() => {
    let cancelled = false;

    const applyFallback = () => {
      if (cancelled) return;
      const ds = utcDayStart(Date.now());
      setDayStart(ds);
      setActivities(buildDayTimeline(ds, []));
    };

    function load() {
      fetch("/api/timeline")
        .then((r) => (r.ok ? r.json() : null))
        .then((data: { dayStart: number; activities: TimelineActivity[] } | null) => {
          if (cancelled) return;
          if (data?.activities?.length && typeof data.dayStart === "number") {
            setDayStart(data.dayStart);
            setActivities(data.activities);
          } else {
            applyFallback();
          }
        })
        .catch(applyFallback);
    }

    load();
    const id = setInterval(load, 5 * 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // NOW marker, updated every 30s (client-only).
  useEffect(() => {
    const update = () => {
      if (dayStart == null) {
        setNowFrac(null);
        return;
      }
      const frac = (Date.now() - dayStart) / DAY_MS;
      setNowFrac(frac >= 0 && frac <= 1 ? frac : null);
    };
    update();
    const id = setInterval(update, 30_000);
    return () => clearInterval(id);
  }, [dayStart]);

  const hourLabels = [0, 4, 8, 12, 16, 20, 24];

  return (
    <PanelFrame
      title={t("panels.crewTimeline").toUpperCase()}
      icon="📅"
      accentColor="var(--color-accent-purple)"
      headerRight={
        <span style={{ fontSize: 8, color: "var(--color-text-muted)", letterSpacing: "0.1em" }}>
          GMT
        </span>
      }
    >
      {/* Hour labels (GMT) */}
      <div
        style={{
          position: "relative",
          display: "flex",
          justifyContent: "space-between",
          marginBottom: 2,
        }}
      >
        {hourLabels.map((h) => (
          <span key={h} style={{ color: "var(--color-text-muted)", fontSize: 8 }}>
            {String(h).padStart(2, "0")}:00
          </span>
        ))}
      </div>

      {/* Timeline bar */}
      <div
        style={{
          position: "relative",
          height: 20,
          borderRadius: 3,
          overflow: "hidden",
          background: "var(--color-bg-secondary)",
          border: "1px solid var(--color-border-subtle)",
        }}
      >
        {dayStart != null &&
          activities.map((act, i) => {
            const leftFrac = (act.startTime - dayStart) / DAY_MS;
            const widthFrac = (act.endTime - act.startTime) / DAY_MS;
            if (leftFrac >= 1 || leftFrac + widthFrac <= 0 || widthFrac <= 0) return null;
            const clampedLeft = Math.max(0, leftFrac);
            const clampedWidth = Math.min(1, leftFrac + widthFrac) - clampedLeft;
            return (
              <div
                key={i}
                title={act.name}
                style={{
                  position: "absolute",
                  top: 0,
                  bottom: 0,
                  left: `${clampedLeft * 100}%`,
                  width: `${clampedWidth * 100}%`,
                  background: ACTIVITY_COLORS[act.type],
                  opacity: 0.85,
                }}
              />
            );
          })}

        {/* NOW marker (client-only to avoid hydration mismatch) */}
        {nowFrac !== null && (
          <div
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              left: `${nowFrac * 100}%`,
              width: 2,
              background: "#fff",
              boxShadow: "0 0 4px rgba(255,255,255,0.8)",
              zIndex: 2,
            }}
          />
        )}
      </div>

      {/* Legend */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "4px 10px",
          marginTop: 6,
        }}
      >
        {(
          [
            ["sleep", t("timeline.sleep")],
            ["science", t("timeline.science")],
            ["exercise", t("timeline.exercise")],
            ["meal", t("timeline.meal")],
            ["eva", t("timeline.eva")],
          ] as [ActivityType, string][]
        ).map(([type, label]) => (
          <div key={type} style={{ display: "flex", alignItems: "center", gap: 3 }}>
            <span
              style={{
                display: "inline-block",
                width: 8,
                height: 8,
                borderRadius: 2,
                background: ACTIVITY_COLORS[type],
              }}
            />
            <span style={{ color: "var(--color-text-muted)", fontSize: 8 }}>{label}</span>
          </div>
        ))}
      </div>

      {/* Honest provenance note: routine is representative; events are real. */}
      <div style={{ color: "var(--color-text-muted)", fontSize: 8, marginTop: 4, fontStyle: "italic" }}>
        {t("timeline.routineNote")}
      </div>
    </PanelFrame>
  );
}
