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
import { normaliseRuleSettings, PROJECT_DEFAULT_RULES } from "@/lib/deliverables";
import { materialiseProjectRules } from "@/lib/job-deliverables";
import { notify } from "@/lib/notifications";
import { canOnProject } from "@/lib/scope";
import {
  can,
  getSessionUser,
  requirePermission,
  type SessionUser,
} from "@/lib/session";
import { DeliverableCategory, PayType, ProjectRole, ProjectStatus } from "@prisma-client";

export type ActionResult = { ok: true; id?: string } | { ok: false; error: string };

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
  externalProjectId: optionalText,
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
      },
    });
    if (!before) return { ok: false, error: "Project not found." };

    const project = await db.project.update({ where: { id }, data });

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
    return { ok: true, id };
  }

  // A new project starts with the standard deliverable rules so a planner has
  // something to switch on rather than a blank list.
  const project = await db.project.create({
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
    },
  });
  if (!before) return { ok: false, error: "Project not found." };

  // Pay and travel are money, and setting money is its own permission. The
  // form leaves them out for anybody without it; what they posted anyway is
  // kept as it was rather than cleared.
  if (!can(actor, "pay.edit_rates")) {
    input.travelReimbursement = before.travelReimbursement?.toString() ?? null;
    input.defaultPayType = before.defaultPayType;
    input.defaultPayRate = before.defaultPayRate?.toString() ?? null;
  }

  const project = await db.project.update({
    where: { id },
    data: {
      breakPaid: input.breakPaid,
      defaultJobTitle: input.defaultJobTitle,
      travelReimbursement: input.travelReimbursement,
      defaultPayType: (input.defaultPayType as PayType | null) ?? null,
      defaultPayRate: input.defaultPayRate,
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
    },
    {
      breakPaid: input.breakPaid,
      defaultJobTitle: input.defaultJobTitle,
      travelReimbursement: input.travelReimbursement,
      defaultPayType: input.defaultPayType,
      defaultPayRate: input.defaultPayRate,
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
