"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { recordAudit } from "@/lib/audit";
import { getCompanySettings } from "@/lib/company";
import { parseZonedDate } from "@/lib/datetime";
import { db } from "@/lib/db";
import { buildPayrollPeriod, fromCents, toCents, weekRange } from "@/lib/payroll";
import { reportIds } from "@/lib/scope";
import {
  getSessionUser,
  permissionScope,
  type SessionUser,
} from "@/lib/session";
import { PayType } from "@prisma-client";

export type ActionResult = { ok: true; id?: string } | { ok: false; error: string };

const ok = (id?: string): ActionResult => ({ ok: true, id });
const fail = (error: string): ActionResult => ({ ok: false, error });

const money = z
  .string()
  .trim()
  .refine((value) => Number.isFinite(Number(value)) && Number(value) >= 0, {
    message: "Enter an amount",
  });

/** Whose payroll this user may act on, for a given permission. */
async function reachable(
  user: SessionUser,
  permission: "payroll.run" | "payroll.approve" | "payroll.mark_received" | "pay.edit_rates",
): Promise<{ all: boolean; ids: string[] } | null> {
  const scope = permissionScope(user, permission);
  if (!scope) return null;
  if (scope === "ALL") return { all: true, ids: [] };
  if (scope === "OWN") return { all: false, ids: [user.id] };
  return { all: false, ids: [user.id, ...(await reportIds(user.id))] };
}

function touch() {
  revalidatePath("/pay");
}

// ---------------------------------------------------------------------------
// Building and approving a week
// ---------------------------------------------------------------------------

const runSchema = z.object({
  userId: z.string().min(1),
  /** Any date inside the week; the Monday is derived. */
  week: z.string().min(1),
});

export async function runPayroll(formData: FormData): Promise<ActionResult> {
  const user = await getSessionUser();
  if (!user) return fail("Not signed in.");

  const parsed = runSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail(z.prettifyError(parsed.error));

  const allowed = await reachable(user, "payroll.run");
  if (!allowed) return fail("You cannot run payroll.");
  if (!allowed.all && !allowed.ids.includes(parsed.data.userId)) {
    return fail("That person does not report to you.");
  }

  const company = await getCompanySettings();

  // The form carries a calendar date; reading it with the Date constructor
  // would take it as UTC midnight and build the wrong week on the west coast.
  const anchor = parseZonedDate(parsed.data.week, company.defaultTimeZone);
  if (!anchor) return fail("That week could not be read.");
  const week = weekRange(anchor, company.defaultTimeZone);

  const periodId = await buildPayrollPeriod({
    userId: parsed.data.userId,
    week,
    timeZone: company.defaultTimeZone,
    payLagWeeks: company.payLagWeeks,
  });

  await recordAudit({
    actorId: user.id,
    entityType: "PayrollPeriod",
    entityId: periodId,
    action: "payroll_built",
    detail: { userId: parsed.data.userId, weekStart: week.start.toISOString() },
  });

  touch();
  return ok(periodId);
}

export async function approvePayroll(formData: FormData): Promise<ActionResult> {
  const user = await getSessionUser();
  if (!user) return fail("Not signed in.");

  const periodId = String(formData.get("periodId") ?? "");
  const period = await db.payrollPeriod.findUnique({
    where: { id: periodId },
    select: {
      id: true,
      status: true,
      userId: true,
      supervisorId: true,
      user: { select: { name: true, directSupervisorId: true } },
    },
  });
  if (!period) return fail("Period not found.");
  if (period.status !== "DRAFT") return fail("This week is already approved.");

  const allowed = await reachable(user, "payroll.approve");
  if (!allowed) return fail("You cannot approve payroll.");

  const isDirectSupervisor = period.user.directSupervisorId === user.id;
  if (!isDirectSupervisor && !allowed.all) {
    return fail(
      "Only this tech's direct supervisor can approve their week. A manager can step in if needed.",
    );
  }

  // A manager stepping in is legitimate but not routine, so it is flagged —
  // the supervisor should be able to see that someone else paid their tech.
  const asFallback = !isDirectSupervisor;

  await db.payrollPeriod.update({
    where: { id: periodId },
    data: {
      status: "APPROVED",
      approvedById: user.id,
      approvedAt: new Date(),
      approvedAsFallback: asFallback,
    },
  });

  if (asFallback && period.supervisorId) {
    await db.notification.create({
      data: {
        userId: period.supervisorId,
        kind: "payroll.fallback_approval",
        title: `${user.name} approved ${period.user.name}'s week`,
        body: "A manager approved a week for one of your techs.",
        href: "/pay",
      },
    });
  }

  await recordAudit({
    actorId: user.id,
    entityType: "PayrollPeriod",
    entityId: periodId,
    action: asFallback ? "payroll_approved_fallback" : "payroll_approved",
    detail: { userId: period.userId },
  });

  touch();
  return ok();
}

// ---------------------------------------------------------------------------
// Overrides and received amounts
// ---------------------------------------------------------------------------

const overrideSchema = z.object({
  lineId: z.string().min(1),
  amount: money,
  note: z.string().trim().min(1, "Say why the amount differs"),
});

export async function overrideLine(formData: FormData): Promise<ActionResult> {
  const user = await getSessionUser();
  if (!user) return fail("Not signed in.");

  const parsed = overrideSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail(z.prettifyError(parsed.error));

  const line = await db.payrollLine.findUnique({
    where: { id: parsed.data.lineId },
    select: {
      id: true,
      totalExpected: true,
      payrollPeriod: { select: { id: true, userId: true, status: true } },
    },
  });
  if (!line) return fail("Line not found.");
  if (line.payrollPeriod.status === "RECEIVED") {
    return fail("This week is closed. Reopen it before changing amounts.");
  }

  const allowed = await reachable(user, "payroll.run");
  if (!allowed) return fail("You cannot change payroll amounts.");
  if (!allowed.all && !allowed.ids.includes(line.payrollPeriod.userId)) {
    return fail("That person does not report to you.");
  }

  await db.payrollLine.update({
    where: { id: line.id },
    data: {
      overrideAmount: parsed.data.amount,
      overrideNote: parsed.data.note,
    },
  });

  await recalculateExpected(line.payrollPeriod.id);

  await recordAudit({
    actorId: user.id,
    entityType: "PayrollLine",
    entityId: line.id,
    action: "payroll_line_overridden",
    detail: {
      from: line.totalExpected.toString(),
      to: parsed.data.amount,
      note: parsed.data.note,
    },
  });

  touch();
  return ok();
}

/** An override replaces the computed total for that job in the week's sum. */
async function recalculateExpected(periodId: string) {
  const lines = await db.payrollLine.findMany({
    where: { payrollPeriodId: periodId },
    select: { totalExpected: true, overrideAmount: true },
  });

  const total = lines.reduce(
    (sum, line) =>
      sum + toCents(line.overrideAmount ?? line.totalExpected),
    0,
  );

  await db.payrollPeriod.update({
    where: { id: periodId },
    data: { expectedAmount: fromCents(total) },
  });
}

const receivedSchema = z.object({
  amount: money,
  receivedDate: z.string().trim().min(1, "When did it land?"),
  note: z.string().trim().max(500).optional(),
});

/**
 * Records what actually arrived, for the week as a whole.
 *
 * REDUCED rather than RECEIVED when the amount is short — the distinction is
 * the whole point of tracking this, and it is set from the numbers rather than
 * asked for, so nobody has to remember to pick it.
 */
export async function markPeriodReceived(
  formData: FormData,
): Promise<ActionResult> {
  const user = await getSessionUser();
  if (!user) return fail("Not signed in.");

  const periodId = String(formData.get("periodId") ?? "");
  const parsed = receivedSchema.safeParse({
    amount: formData.get("amount") ?? "",
    receivedDate: formData.get("receivedDate") ?? "",
    note: formData.get("note") ?? undefined,
  });
  if (!parsed.success) return fail(z.prettifyError(parsed.error));

  const period = await db.payrollPeriod.findUnique({
    where: { id: periodId },
    select: { id: true, userId: true, status: true, expectedAmount: true },
  });
  if (!period) return fail("Period not found.");
  if (period.status === "DRAFT") {
    return fail("Approve the week before recording what arrived.");
  }

  const allowed = await reachable(user, "payroll.mark_received");
  if (!allowed) return fail("You cannot record payments.");
  if (!allowed.all && !allowed.ids.includes(period.userId)) {
    return fail("That is not your payroll.");
  }

  const receivedCents = toCents(parsed.data.amount);
  const expectedCents = toCents(period.expectedAmount);

  await db.payrollPeriod.update({
    where: { id: periodId },
    data: {
      status: receivedCents < expectedCents ? "REDUCED" : "RECEIVED",
      receivedAmount: parsed.data.amount,
      receivedDate: new Date(parsed.data.receivedDate),
      note: parsed.data.note || null,
    },
  });

  await recordAudit({
    actorId: user.id,
    entityType: "PayrollPeriod",
    entityId: periodId,
    action: receivedCents < expectedCents ? "payroll_reduced" : "payroll_received",
    detail: {
      expected: period.expectedAmount.toString(),
      received: parsed.data.amount,
    },
  });

  touch();
  return ok();
}

/**
 * The same, for a single job inside the week.
 *
 * Recorded separately from the week total because a short week is only useful
 * if you can see which job was cut — that is what turns "we were paid less"
 * into something anyone can query the client about.
 */
export async function markLineReceived(
  formData: FormData,
): Promise<ActionResult> {
  const user = await getSessionUser();
  if (!user) return fail("Not signed in.");

  const lineId = String(formData.get("lineId") ?? "");
  const parsed = receivedSchema.safeParse({
    amount: formData.get("amount") ?? "",
    receivedDate: formData.get("receivedDate") ?? "",
    note: formData.get("note") ?? undefined,
  });
  if (!parsed.success) return fail(z.prettifyError(parsed.error));

  const line = await db.payrollLine.findUnique({
    where: { id: lineId },
    select: {
      id: true,
      totalExpected: true,
      overrideAmount: true,
      payrollPeriod: { select: { userId: true, status: true } },
    },
  });
  if (!line) return fail("Line not found.");
  if (line.payrollPeriod.status === "DRAFT") {
    return fail("Approve the week before recording what arrived.");
  }

  const allowed = await reachable(user, "payroll.mark_received");
  if (!allowed) return fail("You cannot record payments.");
  if (!allowed.all && !allowed.ids.includes(line.payrollPeriod.userId)) {
    return fail("That is not your payroll.");
  }

  const expectedCents = toCents(line.overrideAmount ?? line.totalExpected);
  const receivedCents = toCents(parsed.data.amount);

  await db.payrollLine.update({
    where: { id: lineId },
    data: {
      receivedAmount: parsed.data.amount,
      receivedDate: new Date(parsed.data.receivedDate),
      payStatus: receivedCents < expectedCents ? "REDUCED" : "RECEIVED",
      payNote: parsed.data.note || null,
    },
  });

  await recordAudit({
    actorId: user.id,
    entityType: "PayrollLine",
    entityId: lineId,
    action: receivedCents < expectedCents ? "line_reduced" : "line_received",
    detail: { expected: expectedCents / 100, received: receivedCents / 100 },
  });

  touch();
  return ok();
}

// ---------------------------------------------------------------------------
// Pay rates
// ---------------------------------------------------------------------------

const rateSchema = z.object({
  userId: z.string().min(1),
  projectId: z.string().optional(),
  clientId: z.string().optional(),
  payType: z.enum(PayType),
  rate: money,
  travelReimbursement: z.string().trim().optional(),
  note: z.string().trim().max(200).optional(),
});

export async function savePayRate(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const user = await getSessionUser();
  if (!user) return fail("Not signed in.");

  const parsed = rateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail(z.prettifyError(parsed.error));

  const allowed = await reachable(user, "pay.edit_rates");
  if (!allowed) return fail("You cannot set pay rates.");
  if (!allowed.all && !allowed.ids.includes(parsed.data.userId)) {
    return fail("That person does not report to you.");
  }

  const { userId, projectId, clientId, payType, rate, note } = parsed.data;
  const travel = parsed.data.travelReimbursement?.trim();

  // No project and no client means this is the tech's own default, which lives
  // on the user rather than as a rate row.
  if (!projectId && !clientId) {
    await db.user.update({
      where: { id: userId },
      data: { defaultPayType: payType, defaultPayRate: rate },
    });
  } else {
    await db.payRate.upsert({
      where: {
        userId_projectId_clientId: {
          userId,
          projectId: projectId || null,
          clientId: clientId || null,
        } as never,
      },
      update: {
        payType,
        rate,
        travelReimbursement: travel || null,
        note: note || null,
      },
      create: {
        userId,
        projectId: projectId || null,
        clientId: clientId || null,
        payType,
        rate,
        travelReimbursement: travel || null,
        note: note || null,
      },
    });
  }

  await recordAudit({
    actorId: user.id,
    entityType: "PayRate",
    entityId: userId,
    action: "rate_set",
    detail: { projectId: projectId ?? null, clientId: clientId ?? null, payType, rate },
  });

  revalidatePath("/pay/rates");
  return ok();
}

export async function deletePayRate(formData: FormData): Promise<ActionResult> {
  const user = await getSessionUser();
  if (!user) return fail("Not signed in.");

  const id = String(formData.get("id") ?? "");
  const rate = await db.payRate.findUnique({
    where: { id },
    select: { userId: true },
  });
  if (!rate) return fail("Rate not found.");

  const allowed = await reachable(user, "pay.edit_rates");
  if (!allowed) return fail("You cannot set pay rates.");
  if (!allowed.all && !allowed.ids.includes(rate.userId)) {
    return fail("That person does not report to you.");
  }

  await db.payRate.delete({ where: { id } });

  await recordAudit({
    actorId: user.id,
    entityType: "PayRate",
    entityId: id,
    action: "rate_removed",
  });

  revalidatePath("/pay/rates");
  return ok();
}
