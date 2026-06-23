export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";

/**
 * Resolve the CURRENT live YouTube video for each ISS stream at runtime.
 *
 * YouTube assigns a new video id every time a broadcaster ends a stream and
 * starts a new one, so hardcoded ids rot (this was the "Live feed broken" bug).
 * Channel ids are stable, so we resolve each channel's /live page to its current
 * video id, cache it briefly, and fall back to the last-known / seed id if the
 * resolve fails — the player therefore self-heals on the next NASA rotation.
 */

interface StreamSource {
  id: string;
  label: string;
  /** YouTube channel id (UC…) or @handle whose /live page we resolve. */
  channel: string;
  /** Seed id used until first resolve and whenever resolving fails. */
  fallbackVideoId: string;
}

const SOURCES: StreamSource[] = [
  // NASA's official ISS live stream (Earth views + mission coverage).
  { id: "nasa", label: "NASA ISS", channel: "UCLA_DiR1FfKNvjuUpBHmylQ", fallbackVideoId: "uwXgcTc8oY8" },
  // Sen's 24/7 4K Earth-from-ISS stream.
  { id: "sen", label: "Sen 4K", channel: "sen", fallbackVideoId: "fO9e9jnhYK8" },
];

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const VIDEO_ID_RE = /[\w-]{11}/;

interface Resolved {
  videoId: string;
  at: number;
}
const resolveCache = new Map<string, Resolved>();

function channelLiveUrl(channel: string): string {
  return channel.startsWith("UC")
    ? `https://www.youtube.com/channel/${channel}/live`
    : `https://www.youtube.com/@${channel}/live`;
}

/** Fetch a channel's /live page and extract the current live video id. */
async function resolveLiveVideoId(channel: string): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const res = await fetch(channelLiveUrl(channel), {
      signal: controller.signal,
      headers: {
        // A browser-like UA gets the full HTML (with the canonical link) rather
        // than a consent/redirect stub.
        "User-Agent":
          "Mozilla/5.0 (compatible; ISS-Tracker/1.0; +https://iss.cdnspace.ca)",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    if (!res.ok) return null;
    const html = await res.text();

    // The canonical link on a /live page points at the current broadcast.
    const canonical = html.match(
      /<link rel="canonical" href="https:\/\/www\.youtube\.com\/watch\?v=([\w-]{11})"/
    );
    if (canonical && VIDEO_ID_RE.test(canonical[1])) return canonical[1];

    // Fallback: first videoId in the embedded player data.
    const vid = html.match(/"videoId":"([\w-]{11})"/);
    return vid ? vid[1] : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function GET() {
  const now = Date.now();

  const streams = await Promise.all(
    SOURCES.map(async (s) => {
      const cached = resolveCache.get(s.id);
      if (cached && now - cached.at < CACHE_TTL_MS) {
        return { id: s.id, label: s.label, videoId: cached.videoId };
      }
      const resolved = await resolveLiveVideoId(s.channel);
      const videoId = resolved ?? cached?.videoId ?? s.fallbackVideoId;
      resolveCache.set(s.id, { videoId, at: now });
      return { id: s.id, label: s.label, videoId };
    })
  );

  return NextResponse.json({ streams });
}
