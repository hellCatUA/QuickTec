"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { recordAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { flag, optionalText } from "@/lib/form";
import { DOCUMENT_LABELS, storeDocument } from "@/lib/job-documents";
import { requirePermission } from "@/lib/session";
import { deleteFile } from "@/lib/storage";

export type ActionResult = { ok: true; id?: string } | { ok: false; error: string };


function fail(error: unknown): ActionResult {
  if (error instanceof z.ZodError) {
    return { ok: false, error: z.prettifyError(error) };
  }
  // Prisma surfaces a unique-constraint breach as P2002; everything else is a
  // genuine fault and should not be dressed up as a validation message.
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === "P2002"
  ) {
    return { ok: false, error: "That name or code is already in use." };
  }
  throw error;
}

// ---------------------------------------------------------------------------
// Clients — the buyer / representing company on a job
// ---------------------------------------------------------------------------

const clientSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  code: optionalText,
  notes: optionalText,
  active: flag,
});

export async function saveClient(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requirePermission("client.manage");
  const id = String(formData.get("id") ?? "");

  try {
    const data = clientSchema.parse({
      ...Object.fromEntries(formData),
      active: formData.get("active") === "on",
    });

    const client = id
      ? await db.client.update({ where: { id }, data })
      : await db.client.create({ data });

    await recordAudit({
      actorId: actor.id,
      entityType: "Client",
      entityId: client.id,
      action: id ? "updated" : "created",
      detail: { name: client.name },
    });

    revalidatePath("/directory/clients");
    return { ok: true, id: client.id };
  } catch (error) {
    return fail(error);
  }
}

// ---------------------------------------------------------------------------
// Customers — the end brand, e.g. SBUX
// ---------------------------------------------------------------------------

const customerSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  code: z
    .string()
    .trim()
    .min(1, "Code is required")
    // Goes straight into "SBUX #24541" on the client-facing report.
    .max(16, "Keep the code short — it appears in exports")
    .transform((value) => value.toUpperCase()),
  active: flag,
});

export async function saveCustomer(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requirePermission("client.manage");
  const id = String(formData.get("id") ?? "");

  try {
    const data = customerSchema.parse({
      ...Object.fromEntries(formData),
      active: formData.get("active") === "on",
    });

    const customer = id
      ? await db.customer.update({ where: { id }, data })
      : await db.customer.create({ data });

    await recordAudit({
      actorId: actor.id,
      entityType: "Customer",
      entityId: customer.id,
      action: id ? "updated" : "created",
      detail: { name: customer.name, code: customer.code },
    });

    revalidatePath("/directory/customers");
    revalidatePath(`/directory/customers/${customer.id}`);
    return { ok: true, id: customer.id };
  } catch (error) {
    return fail(error);
  }
}

// ---------------------------------------------------------------------------
// Sites
// ---------------------------------------------------------------------------

const siteSchema = z.object({
  customerId: z.string().min(1),
  siteNumber: z.string().trim().min(1, "Site number is required"),
  name: optionalText,
  addressLine1: z.string().trim().min(1, "Address is required"),
  addressLine2: optionalText,
  city: z.string().trim().min(1, "City is required"),
  state: z.string().trim().min(1, "State is required"),
  postalCode: z.string().trim().min(1, "ZIP is required"),
  country: z.string().trim().min(1),
  // Blank means "use the company default", which is the common case.
  timeZone: optionalText,
  notes: optionalText,
  active: flag,
});

export async function saveSite(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requirePermission("client.manage");
  const id = String(formData.get("id") ?? "");

  try {
    const data = siteSchema.parse({
      ...Object.fromEntries(formData),
      active: formData.get("active") === "on",
    });

    const site = id
      ? await db.site.update({ where: { id }, data })
      : await db.site.create({ data });

    await recordAudit({
      actorId: actor.id,
      entityType: "Site",
      entityId: site.id,
      action: id ? "updated" : "created",
      detail: { siteNumber: site.siteNumber, city: site.city },
    });

    revalidatePath(`/directory/customers/${data.customerId}`);
    return { ok: true, id: site.id };
  } catch (error) {
    return fail(error);
  }
}

// ---------------------------------------------------------------------------
// Default blanks kept against a representing company
// ---------------------------------------------------------------------------

/**
 * Stores a blank form a company always uses.
 *
 * A sign-off sheet is nearly always the same document for a given company, and
 * re-uploading it per job is how a job ends up going out on last year's form.
 * Kept here once and offered when a job is raised.
 */
export async function saveClientTemplate(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requirePermission("client.manage");

  const clientId = String(formData.get("clientId") ?? "");
  const kind = String(formData.get("kind") ?? "");
  const label = String(formData.get("label") ?? "").trim();
  const isDefault = formData.get("isDefault") === "on";

  if (kind !== "CLIENT_WORK_ORDER" && kind !== "SIGN_OFF") {
    return { ok: false, error: "Pick what kind of form this is." };
  }

  const client = await db.client.findUnique({
    where: { id: clientId },
    select: { id: true, name: true },
  });
  if (!client) return { ok: false, error: "Company not found." };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Choose a file first." };
  }

  const stored = await storeDocument(file, actor.id, `templates/${client.id}`);
  if ("error" in stored) return { ok: false, error: stored.error };

  const template = await db.clientDocumentTemplate.create({
    data: {
      clientId: client.id,
      kind,
      label: label || file.name || DOCUMENT_LABELS[kind],
      isDefault,
      attachmentId: stored.id,
    },
    select: { id: true },
  });

  // One default per company and kind: two both ticked on the new-job form is
  // two forms going to the customer, and nobody notices until it comes back.
  if (isDefault) {
    await db.clientDocumentTemplate.updateMany({
      where: { clientId: client.id, kind, id: { not: template.id } },
      data: { isDefault: false },
    });
  }

  await recordAudit({
    actorId: actor.id,
    entityType: "ClientDocumentTemplate",
    entityId: template.id,
    action: "created",
    detail: { who: client.name, field: DOCUMENT_LABELS[kind], to: label },
  });

  revalidatePath("/directory/clients");
  revalidatePath("/jobs/new");
  return { ok: true, id: template.id };
}

export async function deleteClientTemplate(
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requirePermission("client.manage");
  const id = String(formData.get("id") ?? "");

  const template = await db.clientDocumentTemplate.findUnique({
    where: { id },
    select: {
      id: true,
      label: true,
      attachment: { select: { id: true, storagePath: true } },
    },
  });
  if (!template) return { ok: false, error: "Not found." };

  // Jobs hold their own copy of the bytes, so removing the template here
  // cannot change what a job that already went out was sent on.
  await deleteFile(template.attachment.storagePath);
  await db.clientDocumentTemplate.delete({ where: { id } });
  await db.attachment.delete({ where: { id: template.attachment.id } });

  await recordAudit({
    actorId: actor.id,
    entityType: "ClientDocumentTemplate",
    entityId: id,
    action: "deleted",
    detail: { from: template.label },
  });

  revalidatePath("/directory/clients");
  revalidatePath("/jobs/new");
  return { ok: true };
}
