import type { MileageCategory } from "@prisma-client";

/**
 * Mileage is a write-off record, not a payment.
 *
 * It exists so a 1099 tech can see and claim their own miles, and so a
 * supervisor can tell when someone actually set off. Money the customer
 * allocates for travel is a separate field on the job.
 *
 * Each leg is its own entry: out to the job, a detour for supplies, the drive
 * home. Two of the categories depend on whether the tech is on the clock at the
 * time, which is checked on the server rather than trusted from the form.
 */

export const MILEAGE_META: Record<
  MileageCategory,
  {
    label: string;
    description: string;
    /** null = available whatever the clock says. */
    requiresClockedIn: boolean | null;
    requiresJob: boolean;
    requiresNote: boolean;
  }
> = {
  IN_ROUTE_TO_WO: {
    label: "In route to WO",
    description: "Driving out to a job. Pick which one.",
    requiresClockedIn: null,
    requiresJob: true,
    requiresNote: false,
  },
  RETURNING_HOME: {
    label: "Returning home",
    description: "The drive home at the end of the day.",
    requiresClockedIn: null,
    requiresJob: false,
    requiresNote: false,
  },
  OFFCLOCK_TOOLS_SUPPLIES: {
    label: "Off-clock tools / supplies",
    description: "A supply run made on your own time.",
    requiresClockedIn: false,
    requiresJob: false,
    requiresNote: false,
  },
  ONCLOCK_TOOLS_SUPPLIES: {
    label: "On-clock tools / supplies",
    description: "A supply run made while clocked in on a job.",
    requiresClockedIn: true,
    requiresJob: false,
    requiresNote: false,
  },
  OTHER: {
    label: "Other",
    description: "Anything else. Say what it was.",
    requiresClockedIn: null,
    requiresJob: false,
    requiresNote: true,
  },
};

export const MILEAGE_CATEGORIES = Object.keys(
  MILEAGE_META,
) as MileageCategory[];

/** Which categories a tech can choose right now. */
export function availableCategories(clockedIn: boolean): MileageCategory[] {
  return MILEAGE_CATEGORIES.filter((category) => {
    const rule = MILEAGE_META[category].requiresClockedIn;
    return rule === null || rule === clockedIn;
  });
}

export function milesBetween(start: number, end: number): number {
  return Math.round((end - start) * 10) / 10;
}

/** Miles times the rate in force when the trip was logged, to the cent. */
export function mileageAmount(miles: number, rate: string | number): string {
  return ((Math.round(miles * 10) / 10) * Number(rate)).toFixed(2);
}
