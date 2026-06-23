export const dynamic = "force-dynamic";

import { type NextRequest, NextResponse } from "next/server";
import { setEventStatus } from "@/lib/db";
import { isAdminAuthorized } from "@/lib/admin-auth";
import type { ISSEvent } from "@/lib/types";

/**
 * Activate or complete an event. The admin UI sends { isActive: boolean }
 * (true → active, false → completed); an explicit { status } is also accepted.
 * In Next 16 dynamic-route `params` is a Promise and must be awaited.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isAdminAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { isActive, status } = (body ?? {}) as {
    isActive?: boolean;
    status?: ISSEvent["status"];
  };

  const nextStatus: ISSEvent["status"] | undefined =
    status ??
    (typeof isActive === "boolean" ? (isActive ? "active" : "completed") : undefined);

  if (!nextStatus) {
    return NextResponse.json(
      { error: "Provide { isActive: boolean } or { status }" },
      { status: 400 }
    );
  }

  try {
    const updated = await setEventStatus(id, nextStatus);
    if (!updated) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, id, status: nextStatus });
  } catch (err) {
    console.error("[admin/events/:id] update error:", err);
    return NextResponse.json({ error: "Failed to update event" }, { status: 500 });
  }
}
