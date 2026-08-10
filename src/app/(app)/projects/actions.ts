"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { diffFields, recordAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { flag, optionalMoney, optionalText } from "@/lib/form";
import { PROJECT_DEFAULT_RULES } from "@/lib/deliverables";
import { notify } from "@/lib/notifications";
import { requirePermission } from "@/lib/session";
import { DeliverableCategory, PayType, ProjectRole, ProjectStatus } from "@prisma-client";

export type ActionResult = { ok: true; id?: string } | { ok: false; error: string };



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
  clientId: z.string().min(1, "Pick a client"),
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
  const actor = await requirePermission("project.manage");
  const id = String(formData.get("id") ?? "");

  const parsed = projectSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: z.prettifyError(parsed.error) };
  }

  const data = parsed.data;

  if (id) {
    const before = await db.project.findUnique({
      where: { id },
      select: { managerId: true, pmContactId: true, name: true },
    });

    const project = await db.project.update({ where: { id }, data });

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
          order: rule.order,
        })),
      },
      // The project manager is a member by definition; leaving them out would
      // hide their own project from their PROJECT-scoped queries.
      members: data.managerId
        ? { create: { userId: data.managerId, role: "PROJECT_MANAGER" } }
        : undefined,
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
  const actor = await requirePermission("project.manage");

  const parsed = memberSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: z.prettifyError(parsed.error) };
  }

  const { projectId, userId, role } = parsed.data;

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
  const actor = await requirePermission("project.manage");
  const projectId = String(formData.get("projectId") ?? "");
  const userId = String(formData.get("userId") ?? "");
  if (!projectId || !userId) return { ok: false, error: "Missing member" };

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
  customLabel: optionalText,
  enabled: flag,
  required: flag,
  requiresPhoto: flag,
  requiresText: flag,
  /** Custom sections are taken away rather than switched off. */
  remove: flag,
});

export async function saveDeliverableRule(
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requirePermission("project.manage");

  const parsed = ruleSchema.safeParse({
    ...Object.fromEntries(formData),
    enabled: formData.get("enabled") === "true",
    required: formData.get("required") === "true",
    requiresPhoto: formData.get("requiresPhoto") === "true",
    requiresText: formData.get("requiresText") === "true",
    remove: formData.get("remove") === "true",
  });
  if (!parsed.success) {
    return { ok: false, error: z.prettifyError(parsed.error) };
  }

  const { projectId, category, remove, ...rule } = parsed.data;

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

  // A section that is off cannot also be mandatory; letting both be true would
  // block checkout on something the tech is never shown.
  const normalised = { ...rule, required: rule.enabled && rule.required };

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
  phone: optionalText,
  email: optionalText,
  note: optionalText,
});

export async function addDispatchContact(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requirePermission("project.manage");

  const parsed = contactSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: z.prettifyError(parsed.error) };
  }

  const { projectId, ...data } = parsed.data;

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
  const actor = await requirePermission("project.manage");
  const id = String(formData.get("id") ?? "");
  const projectId = String(formData.get("projectId") ?? "");
  if (!id) return { ok: false, error: "Missing contact" };

  await db.dispatchContact.delete({ where: { id } });

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
// The representing company's PM/PC — their side, not ours
// ---------------------------------------------------------------------------

const externalContactSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  title: optionalText,
  phone: optionalText,
  email: optionalText,
  clientId: optionalText,
});

/**
 * Adds a person on the representing company's side.
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
 * Puts a change of the representing company's PM/PC on the project timeline.
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
  const actor = await requirePermission("project.manage");
  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, error: "Project not found." };

  const parsed = jobSettingsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: z.prettifyError(parsed.error) };
  }
  const input = parsed.data;

  if (input.defaultPayType && !(input.defaultPayType in PayType)) {
    return { ok: false, error: "Unknown pay type." };
  }
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
