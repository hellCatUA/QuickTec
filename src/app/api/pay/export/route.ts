import { NextResponse } from "next/server";
import { getCompanySettings } from "@/lib/company";
import { parseZonedDate } from "@/lib/datetime";
import { contentDisposition } from "@/lib/exports/guard";
import {
  buildPayWorkbook,
  payExportFileName,
  type PayExportRange,
} from "@/lib/exports/pay-export";
import { weekRange } from "@/lib/payroll";
import { reportIds } from "@/lib/scope";
import { getSessionUser, permissionScope } from "@/lib/session";

/**
 * The pay journal download.
 *
 *   ?week=2026-07-27          one week
 *   ?month=2026-07            every week filed under that month
 *   &user=<id>                a single tech, if the caller may see them
 *
 * Without a user the caller gets everyone they are allowed to see, one sheet
 * each — which for a tech is just themselves.
 */
export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const scope = permissionScope(user, "export.pay");
  if (!scope) return new NextResponse("Not found", { status: 404 });

  const params = new URL(request.url).searchParams;
  const company = await getCompanySettings();
  const timeZone = company.defaultTimeZone;

  let range: PayExportRange;
  const month = params.get("month");

  if (month) {
    const [year, monthNumber] = month.split("-").map(Number);
    if (!year || !monthNumber || monthNumber < 1 || monthNumber > 12) {
      return new NextResponse("Bad month", { status: 400 });
    }
    range = { kind: "month", year, month: monthNumber };
  } else {
    const week = params.get("week");
    // Same reason as the pay page: a bare date string is a calendar date in
    // the company zone, not a UTC instant.
    const anchor = week ? parseZonedDate(week, timeZone) : new Date();
    if (!anchor) return new NextResponse("Bad week", { status: 400 });
    range = { kind: "week", week: weekRange(anchor, timeZone) };
  }

  const allowedIds =
    scope === "ALL"
      ? null
      : scope === "OWN"
        ? [user.id]
        : [user.id, ...(await reportIds(user.id))];

  const requested = params.get("user");
  let userIds: string[];

  if (requested) {
    if (allowedIds !== null && !allowedIds.includes(requested)) {
      return new NextResponse("Not found", { status: 404 });
    }
    userIds = [requested];
  } else if (allowedIds === null) {
    const everyone = await (await import("@/lib/db")).db.user.findMany({
      where: { active: true },
      select: { id: true },
    });
    userIds = everyone.map((entry) => entry.id);
  } else {
    userIds = allowedIds;
  }

  const workbook = await buildPayWorkbook({ userIds, range, timeZone });

  return new NextResponse(new Uint8Array(workbook), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Length": String(workbook.byteLength),
      "Cache-Control": "no-store",
      "Content-Disposition": contentDisposition(
        payExportFileName(range, timeZone),
      ),
    },
  });
}
