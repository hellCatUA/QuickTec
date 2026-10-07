"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { diffFields, recordAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { flag, optionalMoney, optionalText, phoneText } from "@/lib/form";
import {
  customLabelField,
  minPhotosField,
  ruleNoteField,
} from "@/lib/deliverable-settings";
import {
  MAX_LOCATION_NAME,
  normaliseRuleSettings,
  PROJECT_DEFAULT_RULES,
} from "@/lib/deliverables";
import { isLocationIcon } from "@/lib/location-icons";
import { materialiseProjectRules } from "@/lib/job-deliverables";
import { OPEN_LIFECYCLES } from "@/lib/job-status";
import { notify } from "@/lib/notifications";
import { budgetColumns, jobTerms, normaliseTerms, termsError } from "@/lib/budget";
import {
  jobsNumberedWith,
  normaliseProjectCode,
  projectCodeError,
} from "@/lib/project-code";
import { canOnProject } from "@/lib/scope";
import {
  can,
  getSessionUser,
  requirePermission,
  type SessionUser,
} from "@/lib/session";
import {
  DeliverableCategory,
  PayType,
  Prisma,
  ProjectRole,
  ProjectStatus,
} from "@prisma-client";

export type ActionResult =
  | {
      ok: true;
      id?: string;
      /** Something the save did beyond saving, said to whoever pressed it. */
      note?: string;
    }
  | { ok: false; error: string };

const NOT_YOURS: ActionResult = {
  ok: false,
  error: "You cannot change this project.",
};

/**
 * The signed-in user, when they may change this particular project.
 *
 * Every action below names its project, and is checked against it. Asking only
 * whether somebody manages projects at all let a supervisor reach any project
 * there is — including adding themselves to it, which then opened its jobs.
 */
async function projectActor(projectId: string): Promise<SessionUser | null> {
  const user = await getSessionUser();
  if (!user || !projectId) return null;
  return canOnProject(user, "project.manage", projectId) ? user : null;
}

/**
 * The pay a project can start its jobs on: one rate for the whole crew.
 * Flat + hourly needs a flat amount and the hours it covers, which is a
 * budget's shape rather than a rate's — the job's budget is where that lives.
 */
const PROJECT_PAY_TYPES = ["HOURLY", "FLAT", "NON_BILLABLE"] as const;

/**
 * Somebody else saved the same project ID a moment ago.
 *
 * Through the Postgres driver adapter a unique violation carries no
 * `meta.target`; the constraint is under the adapter's own error instead. All
 * three shapes are looked at, by the index's name or its one field.
 */
function takenCode(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code !== "P2002") return false;
  const meta = (error.meta ?? {}) as {
    target?: unknown;
    driverAdapterError?: {
      cause?: { originalMessage?: string; constraint?: { fields?: string[] } };
    };
  };
  const cause = meta.driverAdapterError?.cause;
  const fields = [
    ...(Array.isArray(meta.target) ? meta.target : [meta.target]),
    ...(cause?.constraint?.fields ?? []),
  ].map((field) => String(field ?? "").replace(/"/g, ""));
  return (
    fields.includes("code") ||
    Boolean(cause?.originalMessage?.includes("Project_code_key"))
  );
}

function codeTaken(code: string): ActionResult {
  return {
    ok: false,
    error: `${code} was just taken by another project. Each project needs its own ID.`,
  };
}

/** Every job not yet signed off, the ones a company change can still reach. */
const STILL_OPEN = [...OPEN_LIFECYCLES, "DRAFT" as const];

/**
 * Puts a project's open jobs under its new paying or rep company.
 *
 * Only when asked: a job already raised belongs to whoever the work was for
 * when it was raised, and by default stays there. Asked, it moves the jobs
 * still on the project's old company and nothing else — one somebody put on
 * a different company by hand, or left on an older one at an earlier change,
 * was a decision about that job and is left alone.
 *
 * The paying company does not move on a job that already has their work
 * order uploaded, or a week on it that payroll has approved: that job is the
 * old company's on paper already. A moved job loses a coordinator who works
 * for the old company, and the answer says which moved jobs still carry the
 * old company's blank.
 */
async function moveOpenJobs(input: {
  actorId: string;
  projectId: string;
  client: { fromId: string; id: string; from: string; to: string } | null;
  repCompany: {
    fromId: string | null;
    id: string | null;
    from: string | null;
    to: string | null;
  } | null;
}): Promise<string> {
  const jobs = await db.job.findMany({
    where: { projectId: input.projectId, lifecycle: { in: STILL_OPEN } },
    select: {
      id: true,
      clientId: true,
      repCompanyId: true,
      pmContact: { select: { clientId: true } },
      documents: {
        select: {
          jobDocumentKind: true,
          sourceTemplateId: true,
          sourceTemplate: { select: { clientId: true } },
        },
      },
      assignments: {
        select: {
          payrollLines: {
            where: { payrollPeriod: { status: { not: "DRAFT" } } },
            select: { id: true },
          },
        },
      },
    },
  });

  let movedClient = 0;
  let keptClient = 0;
  let withOldBlank = 0;
  let movedRep = 0;
  let leftAlone = 0;
  for (const job of jobs) {
    const onOldClient = input.client !== null && job.clientId === input.client.fromId;
    const onOldRep =
      input.repCompany !== null && (job.repCompanyId ?? null) === input.repCompany.fromId;
    if ((input.client && !onOldClient) || (input.repCompany && !onOldRep)) leftAlone++;

    // Their work order uploaded — not a blank copied from their template —
    // or a week on the job already paid.
    const settled =
      job.documents.some(
        (document) =>
          document.jobDocumentKind === "CLIENT_WORK_ORDER" && !document.sourceTemplateId,
      ) || job.assignments.some((assignment) => assignment.payrollLines.length > 0);
    const moveClient = onOldClient && !settled;
    if (onOldClient && settled) keptClient++;
    if (!moveClient && !onOldRep) continue;

    await db.job.update({
      where: { id: job.id },
      data: {
        ...(moveClient
          ? {
              clientId: input.client!.id,
              // Their coordinator, not the new company's.
              ...(job.pmContact?.clientId === input.client!.fromId
                ? { pmContactId: null }
                : {}),
            }
          : {}),
        ...(onOldRep ? { repCompanyId: input.repCompany!.id } : {}),
      },
    });
    if (moveClient) {
      movedClient++;
      if (
        job.documents.some(
          (document) => document.sourceTemplate?.clientId === input.client!.fromId,
        )
      ) {
        withOldBlank++;
      }
      await recordAudit({
        actorId: input.actorId,
        entityType: "Job",
        entityId: job.id,
        jobId: job.id,
        action: "field_edited",
        detail: { field: "Paying company", from: input.client!.from, to: input.client!.to },
      });
    }
    if (onOldRep) {
      movedRep++;
      await recordAudit({
        actorId: input.actorId,
        entityType: "Job",
        entityId: job.id,
        jobId: job.id,
        action: "field_edited",
        detail: {
          field: "Rep company",
          from: input.repCompany!.from,
          to: input.repCompany!.to,
        },
      });
    }
    revalidatePath(`/jobs/${job.id}`);
  }

  const plural = (count: number) => `${count} open job${count === 1 ? "" : "s"}`;
  const parts: string[] = [];
  if (input.client) {
    parts.push(`${plural(movedClient)} moved to ${input.client.to}`);
    if (withOldBlank > 0) {
      parts.push(
        `${withOldBlank} of them still carr${withOldBlank === 1 ? "ies" : "y"} ${input.client.from}'s blank`,
      );
    }
    if (keptClient > 0) {
      parts.push(
        `${plural(keptClient)} kept ${input.client.from}: their work order is attached or a week on them is already paid`,
      );
    }
  }
  if (input.repCompany) {
    parts.push(`rep company changed on ${plural(movedRep)}`);
  }
  if (leftAlone > 0) {
    parts.push(`${plural(leftAlone)} left as they were, being on another company already`);
  }
  return `${parts.join("; ")}.`.replace(/^./, (first) => first.toUpperCase());
}

/** How a membership role reads in a message. */
const ROLE_WORDING: Record<ProjectRole, string> = {
  PROJECT_MANAGER: "As the project manager",
  SUPERVISOR: "As a supervisor",
  TECH: "As a tech",
};

/**
 * What the project is. How its jobs get filled in is a separate form and a
 * separate action — sending half of one form's fields through the other is how
 * a save quietly resets a field nobody touched.
 */
const projectSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  code: z.string().transform(normaliseProjectCode),
  // Theirs, all optional: the paying company's and the rep company's own
  // name and ID for the same work.
  clientProjectName: optionalText,
  externalProjectId: optionalText,
  repProjectName: optionalText,
  repProjectId: optionalText,
  clientId: z.string().min(1, "Pick a paying company"),
  repCompanyId: optionalText,
  customerId: optionalText,
  managerId: optionalText,
  pmContactId: optionalText,
  generalScopeOfWork: optionalText,
  status: z.enum(ProjectStatus),
});

export async function saveProject(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const id = String(formData.get("id") ?? "");
  const actor = id ? await projectActor(id) : await getSessionUser();
  if (!actor || (!id && !can(actor, "project.manage"))) return NOT_YOURS;

  const parsed = projectSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: z.prettifyError(parsed.error) };
  }

  const data = parsed.data;

  const codeError = projectCodeError(data.code);
  if (codeError) return { ok: false, error: codeError };
  const sameCode = await db.project.findUnique({
    where: { code: data.code },
    select: { id: true, name: true },
  });
  if (sameCode && sameCode.id !== id) {
    // Named only to somebody who could open it anyway: guessing IDs is not a
    // way to learn the names of projects one is not on.
    return {
      ok: false,
      error: canOnProject(actor, "project.manage", sameCode.id)
        ? `${data.code} is already the ID of ${sameCode.name}. Each project needs its own.`
        : `${data.code} is already another project's ID. Each project needs its own.`,
    };
  }

  // Both are picked from lists, but what arrives is whatever was posted.
  const [client, repCompany] = await Promise.all([
    db.client.findUnique({ where: { id: data.clientId }, select: { name: true } }),
    data.repCompanyId
      ? db.repCompany.findUnique({
          where: { id: data.repCompanyId },
          select: { name: true },
        })
      : null,
  ]);
  if (!client) return { ok: false, error: "That paying company is not in the directory." };
  if (data.repCompanyId && !repCompany) {
    return { ok: false, error: "That rep company is not in the directory." };
  }

  if (id) {
    const before = await db.project.findUnique({
      where: { id },
      select: {
        managerId: true,
        pmContactId: true,
        name: true,
        clientId: true,
        client: { select: { name: true } },
        repCompanyId: true,
        repCompany: { select: { name: true } },
        code: true,
      },
    });
    if (!before) return { ok: false, error: "Project not found." };

    // Fixed once its jobs' numbers carry it — see jobsNumberedWith.
    const lockedOut = (jobs: number, code: string) => ({
      ok: false as const,
      error: `The project ID is in the work order numbers of ${jobs} job${jobs === 1 ? "" : "s"}, so it stays ${code}.`,
    });
    if (before.code !== data.code) {
      const numbered = await jobsNumberedWith(id, before.code);
      if (numbered > 0) return lockedOut(numbered, before.code);
    }

    let project;
    try {
      // Counted again under the project's row lock — the one a job's number
      // takes its counter under — so a job raised between the count above
      // and this save cannot be numbered with an ID that is about to change.
      const saved = await db.$transaction(async (tx) => {
        // The code as it stands under the lock, not as it was read before:
        // somebody else's save in between could have changed it.
        const [locked] = await tx.$queryRaw<{ code: string }[]>`
          SELECT "code" FROM "Project" WHERE "id" = ${id} FOR UPDATE
        `;
        if (locked && locked.code !== data.code) {
          const jobs = await jobsNumberedWith(id, locked.code, tx);
          if (jobs > 0) return { locked: jobs, code: locked.code, project: null };
        }
        return {
          locked: 0,
          code: data.code,
          project: await tx.project.update({ where: { id }, data }),
        };
      });
      if (!saved.project) return lockedOut(saved.locked, saved.code);
      project = saved.project;
    } catch (error) {
      if (takenCode(error)) return codeTaken(data.code);
      throw error;
    }

    // Who the work belongs to is not a detail to bury under "details
    // updated": the jobs raised from now on go to the new company, and the
    // ones already raised stay with the old. Each change says what it was.
    const companyChanges = [
      before.clientId !== data.clientId
        ? { field: "Paying company", from: before.client.name, to: client.name }
        : null,
      (before.repCompanyId ?? null) !== (data.repCompanyId ?? null)
        ? {
            field: "Rep company",
            from: before.repCompany?.name ?? null,
            to: repCompany?.name ?? null,
          }
        : null,
    ].filter((change) => change !== null);
    for (const change of companyChanges) {
      await recordAudit({
        actorId: actor.id,
        entityType: "Project",
        entityId: project.id,
        projectId: project.id,
        action: "project_updated",
        detail: change,
      });
    }

    // The blanks it chose were the old paying company's: a new job here
    // starting on another company's sheet would be a form they never issued.
    if (before.clientId !== data.clientId) {
      await db.project.update({
        where: { id },
        data: { ownTemplates: false, templates: { set: [] } },
      });
    }

    // Asked for: the jobs still being worked go to the new company too.
    const moved =
      companyChanges.length > 0 && formData.get("applyToOpenJobs") === "true"
        ? await moveOpenJobs({
            actorId: actor.id,
            projectId: id,
            client: before.clientId !== data.clientId
              ? {
                  fromId: before.clientId,
                  id: data.clientId,
                  from: before.client.name,
                  to: client.name,
                }
              : null,
            repCompany: (before.repCompanyId ?? null) !== (data.repCompanyId ?? null)
              ? {
                  fromId: before.repCompanyId ?? null,
                  id: data.repCompanyId ?? null,
                  from: before.repCompany?.name ?? null,
                  to: repCompany?.name ?? null,
                }
              : null,
          })
        : null;

    // Handing the project to someone new must also make them a member,
    // otherwise their PROJECT-scoped queries would not reach their own project.
    if (data.managerId) {
      await db.projectMember.upsert({
        where: {
          projectId_userId: { projectId: id, userId: data.managerId },
        },
        update: { role: "PROJECT_MANAGER" },
        create: {
          projectId: id,
          userId: data.managerId,
          role: "PROJECT_MANAGER",
        },
      });
    }

    await recordAudit({
      actorId: actor.id,
      entityType: "Project",
      entityId: project.id,
      projectId: project.id,
      action: "project_updated",
      detail: { name: project.name },
    });

    if ((before?.managerId ?? null) !== (project.managerId ?? null)) {
      await recordManagerChange({
        actorId: actor.id,
        projectId: project.id,
        projectName: project.name,
        fromId: before?.managerId ?? null,
        toId: project.managerId ?? null,
      });
    }

    if ((before?.pmContactId ?? null) !== (project.pmContactId ?? null)) {
      await recordPmContactChange({
        actorId: actor.id,
        projectId: project.id,
        projectName: project.name,
        fromId: before?.pmContactId ?? null,
        toId: project.pmContactId ?? null,
        reason: String(formData.get("pmContactReason") ?? "").trim() || null,
      });
    }

    revalidatePath(`/projects/${id}`);
    revalidatePath(`/projects/${id}/settings`);
    revalidatePath("/projects");
    return { ok: true, id, note: moved ?? undefined };
  }

  // A new project starts with the standard deliverable rules so a planner has
  // something to switch on rather than a blank list.
  let project;
  try {
    project = await db.project.create({
      data: {
        ...data,
        deliverableRules: {
          create: PROJECT_DEFAULT_RULES.map((rule) => ({
            category: rule.category,
            enabled: rule.enabled,
            required: rule.required,
            requiresPhoto: rule.requiresPhoto,
            requiresText: rule.requiresText,
            minPhotos: rule.minPhotos,
            perLocation: rule.perLocation,
            note: rule.note,
            order: rule.order,
          })),
        },
        // The project manager is a member by definition; leaving them out would
        // hide their own project from their PROJECT-scoped queries. So is
        // whoever made it when they can only manage the projects they are on —
        // otherwise the project they just created is one they cannot open.
        members: {
          create: [
            ...(data.managerId
              ? [{ userId: data.managerId, role: "PROJECT_MANAGER" as const }]
              : []),
            ...(!can(actor, "project.manage", { minScope: "ALL" }) &&
            data.managerId !== actor.id
              ? [{ userId: actor.id, role: "SUPERVISOR" as const }]
              : []),
          ],
        },
      },
    });
  } catch (error) {
    if (takenCode(error)) return codeTaken(data.code);
    throw error;
  }

  await recordAudit({
    actorId: actor.id,
    entityType: "Project",
    entityId: project.id,
    projectId: project.id,
    action: "project_created",
    detail: { name: project.name },
  });

  if (project.managerId) {
    await recordManagerChange({
      actorId: actor.id,
      projectId: project.id,
      projectName: project.name,
      fromId: null,
      toId: project.managerId,
    });
  }

  revalidatePath("/projects");
  return { ok: true, id: project.id };
}

/**
 * Puts a change of project manager on the project's timeline and tells the
 * people it is about.
 *
 * Both of them: the person picking it up needs to know they own it, and the
 * person who had it needs to know they no longer do. Finding either out by
 * noticing a project has moved is how work gets dropped.
 */
async function recordManagerChange(input: {
  actorId: string;
  projectId: string;
  projectName: string;
  fromId: string | null;
  toId: string | null;
}): Promise<void> {
  const ids = [input.fromId, input.toId].filter(
    (value): value is string => value !== null,
  );
  const people = await db.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true },
  });
  const nameOf = (id: string | null) =>
    id ? (people.find((person) => person.id === id)?.name ?? null) : null;

  await recordAudit({
    actorId: input.actorId,
    entityType: "Project",
    entityId: input.projectId,
    projectId: input.projectId,
    action: input.toId
      ? input.fromId
        ? "project_pm_changed"
        : "project_pm_assigned"
      : "project_pm_cleared",
    detail: {
      who: nameOf(input.toId) ?? nameOf(input.fromId) ?? undefined,
      from: nameOf(input.fromId),
      to: nameOf(input.toId),
    },
  });

  if (input.toId) {
    await notify({
      userId: input.toId,
      actorId: input.actorId,
      kind: "project_manager",
      title: `You are the project manager on ${input.projectName}`,
      body: input.fromId
        ? `Taken over from ${nameOf(input.fromId) ?? "somebody else"}`
        : null,
      href: `/projects/${input.projectId}`,
      projectId: input.projectId,
    });
  }

  if (input.fromId) {
    await notify({
      userId: input.fromId,
      actorId: input.actorId,
      kind: "project_manager",
      title: `You are no longer the project manager on ${input.projectName}`,
      body: input.toId ? `Now ${nameOf(input.toId)}` : null,
      href: `/projects/${input.projectId}`,
      projectId: input.projectId,
    });
  }
}

const memberSchema = z.object({
  projectId: z.string().min(1),
  userId: z.string().min(1),
  role: z.enum(ProjectRole),
});

export async function upsertProjectMember(
  formData: FormData,
): Promise<ActionResult> {
  const parsed = memberSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: z.prettifyError(parsed.error) };
  }

  const { projectId, userId, role } = parsed.data;
  const actor = await projectActor(projectId);
  if (!actor) return NOT_YOURS;

  const member = await db.user.findUniqueOrThrow({
    where: { id: userId },
    select: { name: true },
  });

  await db.projectMember.upsert({
    where: { projectId_userId: { projectId, userId } },
    update: { role },
    create: { projectId, userId, role },
  });

  await recordAudit({
    actorId: actor.id,
    entityType: "ProjectMember",
    entityId: `${projectId}:${userId}`,
    projectId,
    action: "project_member_added",
    detail: { who: member.name, role },
  });

  const project = await db.project.findUniqueOrThrow({
    where: { id: projectId },
    select: { name: true },
  });
  await notify({
    userId,
    actorId: actor.id,
    kind: "project_manager",
    title: `You are on the ${project.name} project`,
    body: ROLE_WORDING[role],
    href: `/projects/${projectId}`,
    projectId,
  });

  revalidatePath(`/projects/${projectId}`);
  return { ok: true };
}

export async function removeProjectMember(
  formData: FormData,
): Promise<ActionResult> {
  const projectId = String(formData.get("projectId") ?? "");
  const userId = String(formData.get("userId") ?? "");
  if (!projectId || !userId) return { ok: false, error: "Missing member" };
  const actor = await projectActor(projectId);
  if (!actor) return NOT_YOURS;

  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { managerId: true },
  });

  if (project?.managerId === userId) {
    return {
      ok: false,
      error:
        "This person is the project manager. Change the manager first, then remove them.",
    };
  }

  const removed = await db.user.findUnique({
    where: { id: userId },
    select: { name: true },
  });
  await db.projectMember.deleteMany({ where: { projectId, userId } });

  await recordAudit({
    actorId: actor.id,
    entityType: "ProjectMember",
    entityId: `${projectId}:${userId}`,
    projectId,
    action: "project_member_removed",
    detail: { who: removed?.name ?? userId },
  });

  const leftProject = await db.project.findUniqueOrThrow({
    where: { id: projectId },
    select: { name: true },
  });
  await notify({
    userId,
    actorId: actor.id,
    kind: "project_manager",
    title: `You are off the ${leftProject.name} project`,
    href: `/projects`,
    projectId,
  });

  revalidatePath(`/projects/${projectId}`);
  return { ok: true };
}

const ruleSchema = z.object({
  projectId: z.string().min(1),
  category: z.enum(DeliverableCategory),
  customLabel: customLabelField,
  enabled: flag,
  required: flag,
  requiresPhoto: flag,
  requiresText: flag,
  minPhotos: minPhotosField,
  perLocation: flag,
  note: ruleNoteField,
  /** Custom sections are taken away rather than switched off. */
  remove: flag,
});

export async function saveDeliverableRule(
  formData: FormData,
): Promise<ActionResult> {
  const parsed = ruleSchema.safeParse({
    ...Object.fromEntries(formData),
    enabled: formData.get("enabled") === "true",
    required: formData.get("required") === "true",
    requiresPhoto: formData.get("requiresPhoto") === "true",
    requiresText: formData.get("requiresText") === "true",
    perLocation: formData.get("perLocation") === "true",
    remove: formData.get("remove") === "true",
  });
  if (!parsed.success) {
    return { ok: false, error: z.prettifyError(parsed.error) };
  }

  const { projectId, category, remove, ...rule } = parsed.data;
  const actor = await projectActor(projectId);
  if (!actor) return NOT_YOURS;

  await materialiseProjectRules(projectId);

  // A project may hold several custom sections, so the category alone no
  // longer names one of them.
  const where = {
    projectId,
    category,
    jobId: null,
    ...(category === "CUSTOM" ? { customLabel: rule.customLabel } : {}),
  };

  if (remove) {
    if (category !== "CUSTOM" || !rule.customLabel) {
      return { ok: false, error: "Only a custom section can be removed." };
    }
    await db.deliverableRequirement.deleteMany({ where });
    revalidatePath(`/projects/${projectId}`);
    return { ok: true };
  }

  if (category === "CUSTOM" && !rule.customLabel) {
    return { ok: false, error: "Give the section a name." };
  }

  const normalised = normaliseRuleSettings(rule);

  const existing = await db.deliverableRequirement.findFirst({
    where,
    select: { id: true },
  });

  if (existing) {
    await db.deliverableRequirement.update({
      where: { id: existing.id },
      data: normalised,
    });
  } else {
    await db.deliverableRequirement.create({
      data: { projectId, category, ...normalised },
    });
  }

  await recordAudit({
    actorId: actor.id,
    entityType: "DeliverableRequirement",
    entityId: `${projectId}:${category}`,
    projectId,
    action: "project_rules_updated",
    detail: { field: category, ...normalised },
  });

  revalidatePath(`/projects/${projectId}`);
  return { ok: true };
}

const contactSchema = z.object({
  projectId: z.string().min(1),
  label: z.string().trim().min(1, "Label is required"),
  name: optionalText,
  phone: phoneText,
  email: optionalText,
  note: optionalText,
});

export async function addDispatchContact(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = contactSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: z.prettifyError(parsed.error) };
  }

  const { projectId, ...data } = parsed.data;
  const actor = await projectActor(projectId);
  if (!actor) return NOT_YOURS;

  if (!data.phone && !data.email) {
    return { ok: false, error: "Give at least a phone number or an email." };
  }

  const count = await db.dispatchContact.count({ where: { projectId } });
  const contact = await db.dispatchContact.create({
    data: { projectId, ...data, order: count },
  });
  revalidatePath(`/projects/${projectId}/settings`);

  await recordAudit({
    actorId: actor.id,
    entityType: "DispatchContact",
    entityId: contact.id,
    projectId,
    action: "project_updated",
    detail: { field: "Dispatch contact", to: contact.label },
  });

  revalidatePath(`/projects/${projectId}`);
  return { ok: true, id: contact.id };
}

export async function deleteDispatchContact(
  formData: FormData,
): Promise<ActionResult> {
  const id = String(formData.get("id") ?? "");
  const projectId = String(formData.get("projectId") ?? "");
  if (!id) return { ok: false, error: "Missing contact" };
  const actor = await projectActor(projectId);
  if (!actor) return NOT_YOURS;

  // This project's own number, and nothing else by that id: jobs and paying
  // companies keep dispatch numbers in the same table.
  const removed = await db.dispatchContact.deleteMany({ where: { id, projectId } });
  if (removed.count === 0) {
    return { ok: false, error: "That number is not on this project." };
  }
  revalidatePath(`/projects/${projectId}/settings`);

  await recordAudit({
    actorId: actor.id,
    entityType: "DispatchContact",
    entityId: id,
    projectId,
    action: "project_updated",
    detail: { field: "Dispatch contact", from: "removed" },
  });

  revalidatePath(`/projects/${projectId}`);
  return { ok: true };
}

/**
 * Corrects one of the project's numbers.
 *
 * Taken down from somebody speaking, often over a bad line; a wrong digit in
 * the number every job here dials used to mean deleting the row and typing it
 * all again. Jobs have been able to correct theirs; now the project can too.
 */
export async function updateDispatchContact(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = contactSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: z.prettifyError(parsed.error) };
  }
  const { projectId, ...data } = parsed.data;
  const id = String(formData.get("id") ?? "");
  const actor = await projectActor(projectId);
  if (!actor) return NOT_YOURS;

  if (!data.phone && !data.email) {
    return { ok: false, error: "Give at least a phone number or an email." };
  }

  // This project's own number, and nothing else by that id.
  const contact = await db.dispatchContact.findFirst({
    where: { id, projectId },
    select: { label: true },
  });
  if (!contact) return { ok: false, error: "That number is not on this project." };

  await db.dispatchContact.update({ where: { id }, data });

  await recordAudit({
    actorId: actor.id,
    entityType: "DispatchContact",
    entityId: id,
    projectId,
    action: "project_updated",
    detail: { field: "Dispatch contact", from: contact.label, to: data.label },
  });

  revalidatePath(`/projects/${projectId}`);
  revalidatePath(`/projects/${projectId}/settings`);
  return { ok: true, id };
}

// ---------------------------------------------------------------------------
// The rooms every job here starts with
// ---------------------------------------------------------------------------

const projectLocationSchema = z.object({
  projectId: z.string().min(1),
  name: z
    .string()
    .transform((value) => value.replace(/\s+/g, " ").trim())
    .pipe(
      z
        .string()
        .min(1, "Name the location.")
        .max(MAX_LOCATION_NAME, `Keep it to ${MAX_LOCATION_NAME} characters.`)
        // The same rule as on a job, where it becomes a folder in the export.
        .regex(/[\p{L}\p{N}]/u, "Give the location a name with a letter or a number in it."),
    ),
});

/**
 * Adds a room every job raised here will start with.
 *
 * Named as a job names one — the dictionary's name and icon when it knows
 * it, the icon the picker suggested when it does not — because it is copied
 * onto the job as if it had been added there.
 */
export async function addProjectLocation(formData: FormData): Promise<ActionResult> {
  const parsed = projectLocationSchema.safeParse({
    projectId: formData.get("projectId"),
    name: formData.get("name") ?? "",
  });
  if (!parsed.success) return { ok: false, error: z.prettifyError(parsed.error) };
  const { projectId } = parsed.data;
  const actor = await projectActor(projectId);
  if (!actor) return NOT_YOURS;

  const known = await db.knownLocation.findFirst({
    where: { label: { equals: parsed.data.name, mode: "insensitive" } },
    select: { label: true, icon: true },
  });
  const name = known?.label ?? parsed.data.name;
  const offered = formData.get("icon");
  const icon = known
    ? isLocationIcon(known.icon)
      ? known.icon
      : null
    : typeof offered === "string" && isLocationIcon(offered)
      ? offered
      : null;

  const existing = await db.projectLocation.findMany({
    where: { projectId },
    select: { name: true, order: true },
  });
  if (existing.some((one) => one.name.toLowerCase() === name.toLowerCase())) {
    return { ok: false, error: `There is already a location called ${name}.` };
  }

  try {
    await db.projectLocation.create({
      data: {
        projectId,
        name,
        icon,
        order: Math.max(-1, ...existing.map((one) => one.order)) + 1,
      },
    });
  } catch (error) {
    // Two people naming the same room at once: the room is there, and the
    // timeline already says who added it.
    if ((error as { code?: string })?.code !== "P2002") throw error;
    revalidatePath(`/projects/${projectId}/settings`);
    return { ok: true };
  }

  await recordAudit({
    actorId: actor.id,
    entityType: "Project",
    entityId: projectId,
    projectId,
    action: "project_job_settings_updated",
    detail: { fields: "Locations", to: name },
  });

  revalidatePath(`/projects/${projectId}/settings`);
  revalidatePath("/jobs/new");
  return { ok: true };
}

/** Takes a room off the list. Jobs already raised keep theirs. */
export async function removeProjectLocation(formData: FormData): Promise<ActionResult> {
  const projectId = String(formData.get("projectId") ?? "");
  const id = String(formData.get("id") ?? "");
  const actor = await projectActor(projectId);
  if (!actor) return NOT_YOURS;

  const location = await db.projectLocation.findFirst({
    where: { id, projectId },
    select: { name: true },
  });
  if (!location) return { ok: false, error: "That location is not on this project." };
  await db.projectLocation.delete({ where: { id } });

  await recordAudit({
    actorId: actor.id,
    entityType: "Project",
    entityId: projectId,
    projectId,
    action: "project_job_settings_updated",
    detail: { fields: "Locations", from: location.name },
  });

  revalidatePath(`/projects/${projectId}/settings`);
  revalidatePath("/jobs/new");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Which company blanks a new job starts with
// ---------------------------------------------------------------------------

/**
 * The paperwork every job here starts with.
 *
 * By default, the paying company's usual blanks — the ones it has ticked as
 * defaults. A project whose work goes out on a different sheet, or on none,
 * says so once here rather than on every job raised under it.
 */
export async function saveProjectTemplates(formData: FormData): Promise<ActionResult> {
  const projectId = String(formData.get("projectId") ?? "");
  const actor = await projectActor(projectId);
  if (!actor) return NOT_YOURS;

  const own = formData.get("own") === "true";
  const wanted = formData.getAll("templateIds").map(String).filter(Boolean);

  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { clientId: true },
  });
  if (!project) return { ok: false, error: "Project not found." };

  // Only the paying company's own blanks: another company's sheet on these
  // jobs would be a form they never issued.
  const allowed = own
    ? await db.clientDocumentTemplate.findMany({
        where: { id: { in: wanted }, clientId: project.clientId, active: true },
        select: { id: true },
      })
    : [];

  await db.project.update({
    where: { id: projectId },
    data: {
      ownTemplates: own,
      templates: { set: allowed.map((template) => ({ id: template.id })) },
    },
  });

  await recordAudit({
    actorId: actor.id,
    entityType: "Project",
    entityId: projectId,
    projectId,
    action: "project_job_settings_updated",
    detail: {
      fields: "Paperwork",
      to: own ? `${allowed.length} chosen blank${allowed.length === 1 ? "" : "s"}` : "the company's usual",
    },
  });

  revalidatePath(`/projects/${projectId}/settings`);
  revalidatePath("/jobs/new");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// The paying company's PM/PC — their side, not ours
// ---------------------------------------------------------------------------

const externalContactSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  title: optionalText,
  phone: phoneText,
  email: optionalText,
  clientId: optionalText,
});

/**
 * Adds a person on the paying company's side.
 *
 * You meet the same coordinators over and over, so they are records rather
 * than three text fields retyped per project — pick them once and their number
 * comes with them. Internal only: the client report carries the name and
 * nothing else.
 */
export async function createExternalContact(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requirePermission("project.manage");

  const parsed = externalContactSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: z.prettifyError(parsed.error) };
  }

  const contact = await db.externalContact.create({
    data: parsed.data,
    select: { id: true, name: true },
  });

  await recordAudit({
    actorId: actor.id,
    entityType: "ExternalContact",
    entityId: contact.id,
    action: "created",
    detail: { who: contact.name },
  });

  return { ok: true, id: contact.id };
}

/** Rewrites what we hold for somebody. Their number changes; the person does not. */
export async function updateExternalContact(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requirePermission("project.manage");
  const id = String(formData.get("id") ?? "");

  const parsed = externalContactSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: z.prettifyError(parsed.error) };
  }

  const contact = await db.externalContact.update({
    where: { id },
    data: parsed.data,
    select: { id: true, name: true },
  });

  await recordAudit({
    actorId: actor.id,
    entityType: "ExternalContact",
    entityId: contact.id,
    action: "updated",
    detail: { who: contact.name },
  });

  revalidatePath("/projects");
  return { ok: true, id: contact.id };
}

/**
 * Puts a change of the paying company's PM/PC on the project timeline.
 *
 * Kept as its own table rather than only an audit row because the jobs already
 * raised point at whoever ran them, so "who was the coordinator in March" is a
 * question with a real answer that the current value cannot give.
 */
async function recordPmContactChange(input: {
  actorId: string;
  projectId: string;
  projectName: string;
  fromId: string | null;
  toId: string | null;
  reason: string | null;
}) {
  const [from, to] = await Promise.all([
    input.fromId
      ? db.externalContact.findUnique({
          where: { id: input.fromId },
          select: { name: true },
        })
      : null,
    input.toId
      ? db.externalContact.findUnique({
          where: { id: input.toId },
          select: { name: true },
        })
      : null,
  ]);

  await db.projectPmChange.create({
    data: {
      projectId: input.projectId,
      contactId: input.toId,
      changedById: input.actorId,
      reason: input.reason,
    },
  });

  await recordAudit({
    actorId: input.actorId,
    entityType: "Project",
    entityId: input.projectId,
    projectId: input.projectId,
    action: input.fromId
      ? input.toId
        ? "project_pm_contact_changed"
        : "project_pm_contact_cleared"
      : "project_pm_contact_assigned",
    detail: {
      who: to?.name ?? from?.name ?? null,
      from: from?.name ?? null,
      to: to?.name ?? null,
      reason: input.reason,
    },
  });

  // Our own people need to know who to ring now. The contact is external and
  // has no account, so there is nobody on their side to notify.
  const audience = await db.projectMember.findMany({
    where: { projectId: input.projectId },
    select: { userId: true },
  });

  for (const member of audience) {
    await notify({
      userId: member.userId,
      actorId: input.actorId,
      projectId: input.projectId,
      kind: "project_pm",
      title: to
        ? `${to.name} is now the contact on ${input.projectName}`
        : `${input.projectName} has no representing-company contact`,
      body: input.reason,
      href: `/projects/${input.projectId}`,
    });
  }
}

const jobSettingsSchema = z.object({
  breakPaid: flag,
  defaultJobTitle: optionalText,
  travelReimbursement: optionalMoney,
  defaultPayType: optionalText,
  defaultPayRate: optionalMoney,
  // The budget every job starts with. Manual shares are per crew, so a
  // project can only say even or by each tech's rate.
  defaultBudgetType: optionalText,
  defaultBudgetFlat: optionalMoney,
  defaultBudgetFlatHours: optionalMoney,
  defaultBudgetHourly: optionalMoney,
  defaultBudgetSplit: z.enum(["EVEN", "BY_TECH_RATE"]).catch("EVEN"),
});

/**
 * How jobs under this project are filled in.
 *
 * Separate from the project's own details because it is edited on a different
 * rhythm — the identity of a project is set once, the defaults get tuned as
 * the work reveals what it actually looks like.
 */
export async function saveProjectJobSettings(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, error: "Project not found." };
  const actor = await projectActor(id);
  if (!actor) return NOT_YOURS;

  const parsed = jobSettingsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: z.prettifyError(parsed.error) };
  }
  const input = parsed.data;

  if (
    input.defaultPayType &&
    !(PROJECT_PAY_TYPES as readonly string[]).includes(input.defaultPayType)
  ) {
    return { ok: false, error: "Unknown pay type." };
  }
  // Non-billable pays nothing, so there is no rate to ask for.
  if (input.defaultPayType === "NON_BILLABLE") input.defaultPayRate = "0";
  // A rate with no type would be a number nobody can interpret, and a type
  // with no rate pays zero without saying so.
  if (Boolean(input.defaultPayType) !== Boolean(input.defaultPayRate)) {
    return {
      ok: false,
      error: "Set both the pay type and the rate, or neither.",
    };
  }

  const before = await db.project.findUnique({
    where: { id },
    select: {
      breakPaid: true,
      defaultJobTitle: true,
      travelReimbursement: true,
      defaultPayType: true,
      defaultPayRate: true,
      defaultBudgetType: true,
      defaultBudgetFlat: true,
      defaultBudgetFlatHours: true,
      defaultBudgetHourly: true,
      defaultBudgetSplit: true,
    },
  });
  if (!before) return { ok: false, error: "Project not found." };

  // Pay and travel are money, and setting money is its own permission. The
  // form leaves them out for anybody without it; what they posted anyway is
  // kept as it was rather than cleared.
  const canPay = can(actor, "pay.edit_rates");
  if (!canPay) {
    input.travelReimbursement = before.travelReimbursement?.toString() ?? null;
    input.defaultPayType = before.defaultPayType;
    input.defaultPayRate = before.defaultPayRate?.toString() ?? null;
  }

  // The budget, in the job's own shape and through the same zero rule, so it
  // lands on a job exactly as if it had been typed there.
  const beforeBudget = budgetColumns(
    before.defaultBudgetType
      ? jobTerms({
          budgetType: before.defaultBudgetType,
          budgetFlat: before.defaultBudgetFlat,
          budgetFlatHours: before.defaultBudgetFlatHours,
          budgetHourly: before.defaultBudgetHourly,
        })
      : null,
  );
  let budget = beforeBudget;
  let budgetSplit = before.defaultBudgetSplit;
  if (canPay) {
    if (input.defaultBudgetType && !(input.defaultBudgetType in PayType)) {
      return { ok: false, error: "Unknown budget type." };
    }
    const terms = input.defaultBudgetType
      ? normaliseTerms({
          payType: input.defaultBudgetType as PayType,
          flatCents: Math.round(Number(input.defaultBudgetFlat ?? 0) * 100),
          flatMinutes: Math.round(Number(input.defaultBudgetFlatHours ?? 0) * 60),
          hourlyCents: Math.round(Number(input.defaultBudgetHourly ?? 0) * 100),
        })
      : null;
    const wrong = terms ? termsError(terms) : null;
    if (wrong) return { ok: false, error: wrong };
    // A priced budget with nothing in it would be saved as Non-billable and
    // split every new job's crew to $0, over the project's rate.
    if (
      terms?.payType === "NON_BILLABLE" &&
      input.defaultBudgetType !== "NON_BILLABLE"
    ) {
      return {
        ok: false,
        error: "Give the budget an amount, or choose Non-billable.",
      };
    }
    budget = budgetColumns(terms);
    // How it is shared is only asked while there is something to share; a
    // choice made earlier is kept rather than reset by a hidden box.
    budgetSplit =
      terms && terms.payType !== "NON_BILLABLE"
        ? input.defaultBudgetSplit
        : before.defaultBudgetSplit;
  }

  const project = await db.project.update({
    where: { id },
    data: {
      breakPaid: input.breakPaid,
      defaultJobTitle: input.defaultJobTitle,
      travelReimbursement: input.travelReimbursement,
      defaultPayType: (input.defaultPayType as PayType | null) ?? null,
      defaultPayRate: input.defaultPayRate,
      defaultBudgetType: budget.type,
      defaultBudgetFlat: budget.flat,
      defaultBudgetFlatHours: budget.flatHours,
      defaultBudgetHourly: budget.hourly,
      defaultBudgetSplit: budgetSplit,
    },
    select: { id: true, name: true },
  });

  const changed = diffFields(
    {
      breakPaid: before.breakPaid,
      defaultJobTitle: before.defaultJobTitle,
      travelReimbursement: before.travelReimbursement,
      defaultPayType: before.defaultPayType,
      defaultPayRate: before.defaultPayRate,
      defaultBudget: [
        beforeBudget.type,
        beforeBudget.flat,
        beforeBudget.flatHours,
        beforeBudget.hourly,
        before.defaultBudgetSplit,
      ].join(" "),
    },
    {
      breakPaid: input.breakPaid,
      defaultJobTitle: input.defaultJobTitle,
      travelReimbursement: input.travelReimbursement,
      defaultPayType: input.defaultPayType,
      defaultPayRate: input.defaultPayRate,
      defaultBudget: [
        budget.type,
        budget.flat,
        budget.flatHours,
        budget.hourly,
        budgetSplit,
      ].join(" "),
    },
  );

  // Nothing moved, so nothing goes on the timeline: a save that changed
  // nothing is not an event.
  if (Object.keys(changed).length > 0) {
    await recordAudit({
      actorId: actor.id,
      entityType: "Project",
      entityId: project.id,
      projectId: project.id,
      action: "project_job_settings_updated",
      detail: { fields: Object.keys(changed).join(", ") },
    });
  }

  revalidatePath(`/projects/${id}`);
  revalidatePath(`/projects/${id}/settings`);
  revalidatePath("/jobs/new");
  return { ok: true, id };
}
