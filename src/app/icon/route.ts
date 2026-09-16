import { NextResponse } from "next/server";
import { db } from "@/lib/db";

/**
 * The tab and home-screen icon, behind one fixed address.
 *
 * The configured icon used to be read in the root layout's generateMetadata,
 * which put a database query in front of every prerendered page — and a
 * production build has no database, so `next build` died on /_not-found. A
 * fixed URL in the metadata and the lookup behind it keeps the build offline,
 * keeps the query off every page render, and lets the icon change without
 * anything being rebuilt.
 *
 * A failure here falls through to the bundled icon rather than propagating:
 * the favicon is not worth a 500, and this is the one request that would
 * otherwise turn a database blip into a broken-looking tab.
 */
export const dynamic = "force-dynamic";

const BUNDLED = "/icons/icon.svg";

export async function GET(request: Request) {
  let configured: string | null = null;
  try {
    const company = await db.companySettings.findUnique({
      where: { id: "singleton" },
      select: { appIconUrl: true },
    });
    configured = company?.appIconUrl?.trim() || null;
  } catch {
    configured = null;
  }

  // Only somewhere a browser can actually be sent. A data: URI is legal in the
  // settings field and renders fine in an <img>, but it is not a Location a
  // redirect can carry, so it falls back rather than failing.
  const target =
    configured &&
    (configured.startsWith("http://") ||
      configured.startsWith("https://") ||
      configured.startsWith("/"))
      ? configured
      : BUNDLED;

  return NextResponse.redirect(new URL(target, request.url), {
    status: 307,
    // Short, because the point of the setting is that it can be changed. Long
    // enough that a tab full of pages does not ask thirty times.
    headers: { "Cache-Control": "public, max-age=300" },
  });
}
