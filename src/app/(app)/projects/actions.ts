"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { recordAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { PROJECT_DEFAULT_RULES } from "@/lib/deliverables";
import { requirePermission } from "@/lib/session";
import { DeliverableCategory, ProjectRole, ProjectStatus } from "@prisma-client";

export type ActionResult = { ok: true; id?: string } | { ok: false; error: string };

const optionalText = z
  .string()
  .trim()
  .transform((value) => (value === "" ? null : value));

const optionalMoney = z
  .string()
  .trim()
  .transform((value) => (value === "" ? null : value))
  .refine(
    (value) => value === null || (!Number.isNaN(Number(value)) && Number(value) >= 0),
    { message: "Enter a positive amount, or leave it blank" },
  );

const projectSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  externalProjectId: optionalText,
  clientId: z.string().min(1, "Pick a client"),
  customerId: optionalText,
  managerId: optionalText,
  generalScopeOfWork: optionalText,
  travelReimbursement: optionalMoney,
  breakPaid: z.coerce.boolean(),
  status: z.enum(ProjectStatus),
});

export async function saveProject(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requirePermission("project.manage");
  const id = String(formData.get("id") ?? "");

  const parsed = projectSchema.safeParse({
    ...Object.fromEntries(formData),
    breakPaid: formData.get("breakPaid") === "on",
  });
  if (!parsed.success) {
    return { ok: false, error: z.prettifyError(parsed.error) };
  }

  const data = parsed.data;

  if (id) {
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
      action: "updated",
      detail: { name: project.name },
    });
    revalidatePath(`/projects/${id}`);
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
    action: "created",
    detail: { name: project.name },
  });

  revalidatePath("/projects");
  return { ok: true, id: project.id };
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

  await db.projectMember.upsert({
    where: { projectId_userId: { projectId, userId } },
    update: { role },
    create: { projectId, userId, role },
  });

  await recordAudit({
    actorId: actor.id,
    entityType: "ProjectMember",
    entityId: `${projectId}:${userId}`,
    action: "set",
    detail: { role },
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

  await db.projectMember.deleteMany({ where: { projectId, userId } });

  await recordAudit({
    actorId: actor.id,
    entityType: "ProjectMember",
    entityId: `${projectId}:${userId}`,
    action: "removed",
  });

  revalidatePath(`/projects/${projectId}`);
  return { ok: true };
}

const ruleSchema = z.object({
  projectId: z.string().min(1),
  category: z.enum(DeliverableCategory),
  customLabel: optionalText,
  enabled: z.coerce.boolean(),
  required: z.coerce.boolean(),
  requiresPhoto: z.coerce.boolean(),
  requiresText: z.coerce.boolean(),
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
  });
  if (!parsed.success) {
    return { ok: false, error: z.prettifyError(parsed.error) };
  }

  const { projectId, category, ...rule } = parsed.data;

  // A section that is off cannot also be mandatory; letting both be true would
  // block checkout on something the tech is never shown.
  const normalised = { ...rule, required: rule.enabled && rule.required };

  const existing = await db.deliverableRequirement.findFirst({
    where: { projectId, category, jobId: null },
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
    action: "set",
    detail: normalised,
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
    action: "created",
    detail: { label: contact.label },
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
    action: "deleted",
  });

  revalidatePath(`/projects/${projectId}`);
  return { ok: true };
}
