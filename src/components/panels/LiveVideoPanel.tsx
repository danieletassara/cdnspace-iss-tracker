"use client";

import { useState, useEffect } from "react";
import PanelFrame from "@/components/shared/PanelFrame";
import { useLocale } from "@/context/LocaleContext";

interface Stream {
  id: string;
  label: string;
  videoId: string;
}

// Seed list used until /api/live-streams resolves the current ids (and if it
// fails). The API resolves each channel's CURRENT live video so the embed
// self-heals when NASA/Sen rotate their stream ids.
const FALLBACK_STREAMS: Stream[] = [
  { id: "nasa", label: "NASA ISS", videoId: "uwXgcTc8oY8" },
  { id: "sen", label: "Sen 4K", videoId: "fO9e9jnhYK8" },
];

export default function LiveVideoPanel() {
  const { t } = useLocale();
  const [streams, setStreams] = useState<Stream[]>(FALLBACK_STREAMS);
  const [activeIdx, setActiveIdx] = useState(0);
  // Cache-buster forces fresh iframe on mount and stream switch
  const [cacheBuster, setCacheBuster] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    fetch("/api/live-streams")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { streams?: Stream[] } | null) => {
        if (cancelled || !data?.streams?.length) return;
        setStreams(data.streams);
        setActiveIdx((i) => Math.min(i, data.streams!.length - 1));
      })
      .catch(() => {
        /* keep fallback streams */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setCacheBuster(Date.now());
  }, [activeIdx]);

  const active = streams[activeIdx] ?? streams[0];

  const cameraToggle = (
    <div style={{ display: "flex", gap: 3 }}>
      {streams.map((stream, i) => (
        <button
          key={stream.id}
          onClick={() => setActiveIdx(i)}
          style={{
            padding: "1px 6px",
            borderRadius: 3,
            border:
              activeIdx === i
                ? "1px solid var(--color-accent-red)"
                : "1px solid var(--color-border-accent)",
            background:
              activeIdx === i ? "rgba(255,61,61,0.15)" : "transparent",
            color:
              activeIdx === i
                ? "var(--color-accent-red)"
                : "var(--color-text-muted)",
            cursor: "pointer",
            fontSize: 9,
            fontFamily: "inherit",
          }}
        >
          {stream.label}
        </button>
      ))}
    </div>
  );

  return (
    <PanelFrame
      title={t("panels.liveVideo").toUpperCase()}
      icon="🔴"
      accentColor="var(--color-accent-red)"
      headerRight={cameraToggle}
      bodyClassName=""
    >
      <div style={{ position: "relative", width: "100%", aspectRatio: "16 / 9" }}>
        <iframe
          key={`${active.videoId}-${cacheBuster}`}
          src={`https://www.youtube.com/embed/${active.videoId}?autoplay=1&mute=1&controls=1&rel=0&_=${cacheBuster}`}
          title={`ISS Live — ${active.label}`}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            border: "none",
            borderRadius: "0 0 4px 4px",
          }}
        />
      </div>
    </PanelFrame>
  );
}
