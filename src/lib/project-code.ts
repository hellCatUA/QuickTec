import { db } from "@/lib/db";
import { NO_PROJECT_REF } from "@/lib/int-wo-format";

/**
 * Our own project ID — the one the app shows, and the one in the middle of
 * every INT WO number raised under the project: 2610-PRJ12-0042.
 *
 * Upper case, letters, digits and dashes, because it is read off a phone and
 * written onto paper forms; never 0000, which is what a job with no project
 * carries. Unique, because the number is only unique if this is: each project
 * counts its own jobs from 1, and two projects sharing a code — or both going
 * without one, as they could when this was the paying company's ID — issue the
 * same numbers and the second job cannot be created.
 */

const PATTERN = /^[A-Z0-9][A-Z0-9-]{0,19}$/;

export function normaliseProjectCode(raw: string): string {
  return raw.trim().toUpperCase();
}

/** Why a code cannot be used, or null when it can. Uniqueness is the caller's. */
export function projectCodeError(code: string): string | null {
  if (!code) return "Give the project an ID.";
  if (code === NO_PROJECT_REF) {
    return `${NO_PROJECT_REF} is what a job with no project carries — pick another ID.`;
  }
  if (!PATTERN.test(code)) {
    return "A project ID is up to 20 letters, digits and dashes, starting with a letter or digit.";
  }
  return null;
}

/**
 * The next P001, P002 … nobody has, offered when a project is created.
 *
 * Skips one that is some project's paying-company ID too: jobs numbered
 * before we had our own IDs carry those, and a new project given one would be
 * numbering its jobs alongside them.
 */
export async function nextProjectCode(): Promise<string> {
  const projects = await db.project.findMany({
    select: { code: true, externalProjectId: true },
  });
  const taken = new Set(
    projects.flatMap((project) => [
      project.code,
      project.externalProjectId?.trim().toUpperCase() ?? "",
    ]),
  );
  for (let counter = 1; ; counter++) {
    const code = `P${String(counter).padStart(3, "0")}`;
    if (!taken.has(code)) return code;
  }
}
