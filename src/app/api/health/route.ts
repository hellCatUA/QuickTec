import { NextResponse } from "next/server";

// Used by the connection indicator and by the Docker healthcheck. Deliberately
// does not touch Postgres so a slow query cannot mark the app as offline.
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ ok: true, at: new Date().toISOString() });
}

export function HEAD() {
  return new Response(null, { status: 200 });
}
