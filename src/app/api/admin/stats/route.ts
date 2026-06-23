export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getPageViews } from "@/lib/db";
import { isAdminAuthorized } from "@/lib/admin-auth";

export async function GET(request: NextRequest) {
  if (!isAdminAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const pageViews = await getPageViews();
    return NextResponse.json({ pageViews });
  } catch (err) {
    console.error("[admin-stats] query error:", err);
    return NextResponse.json(
      { error: "Failed to fetch admin stats" },
      { status: 500 }
    );
  }
}
