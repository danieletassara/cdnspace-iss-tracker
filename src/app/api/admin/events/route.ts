export const dynamic = "force-dynamic";

import { type NextRequest, NextResponse } from "next/server";
import { getAllEvents, upsertEvent } from "@/lib/db";
import { isAdminAuthorized } from "@/lib/admin-auth";
import type { ISSEvent } from "@/lib/types";

export async function GET(request: NextRequest) {
  if (!isAdminAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const events = await getAllEvents(200);
    return NextResponse.json(events);
  } catch (err) {
    console.error("[admin/events] list error:", err);
    return NextResponse.json(
      { error: "Failed to list events" },
      { status: 500 }
    );
  }
}

async function handleUpsert(request: NextRequest): Promise<NextResponse> {
  if (!isAdminAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const event = body as Partial<ISSEvent>;

  if (
    !event.id ||
    !event.type ||
    !event.title ||
    !event.description ||
    !event.status ||
    event.scheduledStart == null ||
    event.scheduledEnd == null
  ) {
    return NextResponse.json(
      {
        error:
          "Missing required fields: id, type, title, description, status, scheduledStart, scheduledEnd",
      },
      { status: 400 }
    );
  }

  const fullEvent: ISSEvent = {
    id: event.id,
    type: event.type,
    title: event.title,
    description: event.description,
    status: event.status,
    scheduledStart: event.scheduledStart,
    scheduledEnd: event.scheduledEnd,
    actualStart: event.actualStart ?? null,
    actualEnd: event.actualEnd ?? null,
    metadata: event.metadata ?? {},
  };

  try {
    await upsertEvent(fullEvent);
    return NextResponse.json({ ok: true, id: fullEvent.id });
  } catch (err) {
    console.error("[admin/events] upsert error:", err);
    return NextResponse.json(
      { error: "Failed to upsert event" },
      { status: 500 }
    );
  }
}

export function POST(request: NextRequest) {
  return handleUpsert(request);
}

export function PUT(request: NextRequest) {
  return handleUpsert(request);
}
