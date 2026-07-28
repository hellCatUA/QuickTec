import ExcelJS from "exceljs";
import { usDateInZone, usTimeInZone } from "@/lib/datetime";
import { db } from "@/lib/db";
import { weekLabel, weeksInMonth, type WeekRange } from "@/lib/payroll";

/**
 * The pay journal.
 *
 * One sheet per tech, so a supervisor's download is a workbook of their team
 * and a tech's is a single sheet of their own. Column order is fixed by the
 * business — this is read side by side with what actually landed in the bank.
 *
 * Received pay is carried twice on purpose: once for the week and once for
 * each job. A short week is only actionable if you can see which job was cut.
 */

const COLUMNS: { header: string; width: number }[] = [
  { header: "Date", width: 12 },
  { header: "WO Title", width: 28 },
  { header: "Company / Customer", width: 26 },
  { header: "Address", width: 34 },
  { header: "Clock In – Clock Out", width: 22 },
  { header: "Total time", width: 11 },
  { header: "Pay Type", width: 13 },
  { header: "Pay Rate", width: 11 },
  { header: "Total Labor", width: 13 },
  { header: "Travel reimb", width: 13 },
  { header: "Parking/Tolls reimb", width: 18 },
  { header: "Hotel reimb", width: 12 },
  { header: "Total Expected", width: 15 },
  { header: "Received (job)", width: 14 },
  { header: "Received (week)", width: 15 },
  { header: "Pay Status", width: 12 },
  { header: "Received Date", width: 14 },
  { header: "Pay Note", width: 30 },
];

const MONEY = '"$"#,##0.00';

export type PayExportRange =
  | { kind: "week"; week: WeekRange }
  | { kind: "month"; year: number; month: number };

export function payExportFileName(
  range: PayExportRange,
  timeZone: string,
): string {
  if (range.kind === "week") {
    return `Pay-${usDateInZone(range.week.start, timeZone).replace(/-/g, "")}.xlsx`;
  }
  return `Pay-${range.year}-${String(range.month).padStart(2, "0")}.xlsx`;
}

export async function buildPayWorkbook(input: {
  userIds: string[];
  range: PayExportRange;
  timeZone: string;
}): Promise<Buffer> {
  const { userIds, range, timeZone } = input;

  const weekStarts =
    range.kind === "week"
      ? [range.week.start]
      : weeksInMonth(range.year, range.month, timeZone).map((week) => week.start);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "QuickTec";
  workbook.created = new Date();

  const users = await db.user.findMany({
    where: { id: { in: userIds } },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  for (const user of users) {
    const periods = await db.payrollPeriod.findMany({
      where: { userId: user.id, weekStart: { in: weekStarts } },
      orderBy: { weekStart: "asc" },
      select: {
        weekStart: true,
        status: true,
        expectedAmount: true,
        receivedAmount: true,
        receivedDate: true,
        note: true,
        lines: {
          orderBy: { assignment: { job: { scheduledStart: "asc" } } },
          select: {
            payType: true,
            payRate: true,
            paidMinutes: true,
            laborAmount: true,
            travelReimb: true,
            parkingTollsReimb: true,
            hotelReimb: true,
            totalExpected: true,
            overrideAmount: true,
            overrideNote: true,
            receivedAmount: true,
            receivedDate: true,
            payStatus: true,
            payNote: true,
            assignment: {
              select: {
                job: {
                  select: {
                    title: true,
                    client: { select: { name: true } },
                    customer: { select: { name: true } },
                    site: {
                      select: {
                        addressLine1: true,
                        city: true,
                        state: true,
                        postalCode: true,
                      },
                    },
                  },
                },
                visits: {
                  orderBy: { clockInAt: "asc" },
                  select: { clockInAt: true, clockOutAt: true },
                },
              },
            },
          },
        },
      },
    });

    // Excel refuses several characters in a sheet name and truncates at 31.
    const sheet = workbook.addWorksheet(
      user.name.replace(/[*?:/\\[\]]/g, " ").slice(0, 31) || "Tech",
    );

    sheet.columns = COLUMNS.map((column) => ({
      header: column.header,
      width: column.width,
    }));
    sheet.getRow(1).font = { bold: true };
    sheet.views = [{ state: "frozen", ySplit: 1 }];

    for (const period of periods) {
      const weekRow = sheet.addRow([weekLabel(period.weekStart, timeZone)]);
      weekRow.font = { bold: true };

      for (const line of period.lines) {
        const job = line.assignment.job;
        const clockIns = line.assignment.visits.map((visit) => visit.clockInAt);
        const clockOuts = line.assignment.visits
          .map((visit) => visit.clockOutAt)
          .filter((date): date is Date => date !== null);

        const onsite =
          clockIns.length > 0
            ? new Date(Math.min(...clockIns.map((date) => date.getTime())))
            : null;
        const offsite =
          clockOuts.length > 0
            ? new Date(Math.max(...clockOuts.map((date) => date.getTime())))
            : null;

        // An override replaces the computed figure — it is the number the
        // supervisor actually intends to pay.
        const expected = Number(
          (line.overrideAmount ?? line.totalExpected).toString(),
        );

        const row = sheet.addRow([
          onsite ? usDateInZone(onsite, timeZone) : "",
          job.title,
          `${job.client.name} / ${job.customer.name}`,
          `${job.site.addressLine1}, ${job.site.city}, ${job.site.state} ${job.site.postalCode}`,
          onsite && offsite
            ? `${usTimeInZone(onsite, timeZone)} – ${usTimeInZone(offsite, timeZone)}`
            : "",
          `${(line.paidMinutes / 60).toFixed(2)} hrs`,
          line.payType.replace("_", "-").toLowerCase(),
          Number(line.payRate.toString()),
          Number(line.laborAmount.toString()),
          Number(line.travelReimb.toString()),
          Number(line.parkingTollsReimb.toString()),
          Number(line.hotelReimb.toString()),
          expected,
          line.receivedAmount ? Number(line.receivedAmount.toString()) : null,
          period.receivedAmount ? Number(period.receivedAmount.toString()) : null,
          line.payStatus,
          line.receivedDate ? usDateInZone(line.receivedDate, timeZone) : "",
          [line.overrideNote, line.payNote].filter(Boolean).join(" · "),
        ]);

        for (const index of [8, 9, 10, 11, 12, 13, 14, 15]) {
          row.getCell(index).numFmt = MONEY;
        }

        // A short payment is the thing anyone opening this file is looking
        // for, so it is coloured rather than left to be spotted.
        if (line.payStatus === "REDUCED") {
          row.getCell(16).font = { color: { argb: "FFB00020" }, bold: true };
        }
      }

      const totalRow = sheet.addRow([
        "",
        `${period.status} — ${periods.length > 1 ? weekLabel(period.weekStart, timeZone) : "week total"}`,
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        Number(period.expectedAmount.toString()),
        null,
        period.receivedAmount ? Number(period.receivedAmount.toString()) : null,
        period.status,
        period.receivedDate ? usDateInZone(period.receivedDate, timeZone) : "",
        period.note ?? "",
      ]);
      totalRow.font = { bold: true };
      totalRow.getCell(13).numFmt = MONEY;
      totalRow.getCell(15).numFmt = MONEY;

      sheet.addRow([]);
    }

    if (periods.length === 0) {
      sheet.addRow(["No payroll recorded for this period."]);
    }
  }

  return Buffer.from(await workbook.xlsx.writeBuffer());
}
