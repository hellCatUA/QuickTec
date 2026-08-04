"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { recordAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { flag, optionalText } from "@/lib/form";
import { analyzeForm, type FormAnalysis } from "@/lib/forms/analyze";
import {
  DOCUMENT_LABELS,
  attachTemplatesToOpenJobs,
  storeDocument,
  type TemplateRollout,
} from "@/lib/job-documents";
import { requirePermission } from "@/lib/session";
import { deleteFile } from "@/lib/storage";

export type ActionResult =
  | { ok: true; id?: string; attachedToJobs?: number }
  | { ok: false; error: string };


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

  // Read the blank while we have it: a PDF that declares its own fields hands
  // us the boxes for free, and everything else needs them drawn once by hand.
  // Doing it here means the mapping screen opens knowing what it is looking at.
  let analysis: FormAnalysis | null = null;
  if (file.type === "application/pdf") {
    try {
      analysis = await analyzeForm(Buffer.from(await file.arrayBuffer()));
    } catch (error) {
      // A file we cannot parse is still a file worth keeping — it just cannot
      // be filled automatically, which is exactly where we were before.
      console.error("[directory] reading a blank for its fields failed", error);
    }
  }

  // Anything past here is a database write, and an unhandled throw would reach
  // the person as a Next.js error digest — a number with no way to act on it.
  try {
    const template = await db.clientDocumentTemplate.create({
      data: {
        clientId: client.id,
        kind,
        label: label || file.name || DOCUMENT_LABELS[kind],
        isDefault,
        attachmentId: stored.id,
        boxSource: analysis?.boxSource ?? null,
        pageCount: analysis?.pageCount ?? null,
        pageWidth: analysis?.pageWidth ?? null,
        pageHeight: analysis?.pageHeight ?? null,
        placements: analysis
          ? {
              create: analysis.placements.map((placement) => ({
                fieldName: placement.fieldName,
                page: placement.page,
                x: placement.x,
                y: placement.y,
                width: placement.width,
                height: placement.height,
                kind: placement.kind,
                sampleText: placement.sampleText,
                // Set only where the field named a value outright, which is
                // something a blank has to be prepared for on purpose.
                source: placement.source,
                rowIndex: placement.rowIndex,
                order: placement.order,
              })),
            }
          : undefined,
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

    // A form added today is one the crew needs on the job they are doing
    // today. Attaching it only to jobs raised from now on is how somebody
    // arrives on site without the sheet.
    let rollout: TemplateRollout = { jobs: 0, copies: 0 };
    if (isDefault) {
      try {
        rollout = await attachTemplatesToOpenJobs(client.id, actor.id, template.id);
      } catch (error) {
        // The form is saved either way; reaching the open jobs is a
        // convenience with a button of its own to fall back on.
        console.error("[directory] putting a new form onto open jobs failed", error);
      }
    }

    revalidatePath("/directory/clients");
    revalidatePath("/jobs/new");
    return { ok: true, id: template.id, attachedToJobs: rollout.jobs };
  } catch (error) {
    // The bytes are on disk but nothing points at them; drop the orphan rather
    // than leaving a file nobody can reach or delete.
    console.error("[directory] saving a default form failed", error);
    await deleteFileFor(stored.id);
    return {
      ok: false,
      error: "That form could not be saved. The server log has the detail.",
    };
  }
}

export type RolloutResult =
  | { ok: true; jobs: number; copies: number }
  | { ok: false; error: string };

/**
 * Puts this company's forms onto every job of theirs that is still open.
 *
 * The same thing that happens when a form is added, on demand. It is here
 * because the automatic pass cannot cover everything: a form uploaded before
 * this existed, one that was not marked default at the time, or a job created
 * while the copy was failing. Running it twice changes nothing.
 */
export async function updateOpenJobsWithForms(
  formData: FormData,
): Promise<RolloutResult> {
  const actor = await requirePermission("client.manage");
  const clientId = String(formData.get("clientId") ?? "");

  const client = await db.client.findUnique({
    where: { id: clientId },
    select: { id: true, name: true },
  });
  if (!client) return { ok: false, error: "Company not found." };

  let rollout: TemplateRollout;
  try {
    rollout = await attachTemplatesToOpenJobs(client.id, actor.id);
  } catch (error) {
    console.error("[directory] updating open jobs with forms failed", error);
    return {
      ok: false,
      error: "The jobs could not be updated. The server log has the detail.",
    };
  }

  if (rollout.copies > 0) {
    await recordAudit({
      actorId: actor.id,
      entityType: "Client",
      entityId: client.id,
      action: "updated",
      detail: {
        field: "forms on open jobs",
        to: `${rollout.copies} added across ${rollout.jobs} job${rollout.jobs === 1 ? "" : "s"}`,
      },
    });
    revalidatePath("/jobs");
  }

  revalidatePath("/directory/clients");
  return { ok: true, jobs: rollout.jobs, copies: rollout.copies };
}

// ---------------------------------------------------------------------------
// Numbers held against a representing company
// ---------------------------------------------------------------------------

const dispatchSchema = z.object({
  clientId: z.string().min(1),
  label: z.string().trim().min(1, "Say who they are"),
  name: optionalText,
  phone: optionalText,
  email: optionalText,
  note: optionalText,
});

/**
 * A number to reach on any job for this company.
 *
 * Their NOC line and their after-hours desk are the same on every job they
 * send. Kept here once and offered when a job is raised, rather than typed
 * again each time — which is how the fortieth one ends up with a digit wrong.
 */
export async function saveClientDispatch(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requirePermission("client.manage");
  const id = String(formData.get("id") ?? "");

  try {
    const data = dispatchSchema.parse(Object.fromEntries(formData));

    const client = await db.client.findUnique({
      where: { id: data.clientId },
      select: { id: true, name: true },
    });
    if (!client) return { ok: false, error: "Company not found." };

    const last = await db.dispatchContact.findFirst({
      where: { clientId: client.id },
      orderBy: { order: "desc" },
      select: { order: true },
    });

    const contact = id
      ? await db.dispatchContact.update({ where: { id }, data })
      : await db.dispatchContact.create({
          data: { ...data, order: (last?.order ?? -1) + 1 },
        });

    await recordAudit({
      actorId: actor.id,
      entityType: "Client",
      entityId: client.id,
      action: "updated",
      detail: { who: client.name, field: "dispatch contact", to: contact.label },
    });

    revalidatePath("/directory/clients");
    revalidatePath("/jobs/new");
    return { ok: true, id: contact.id };
  } catch (error) {
    return fail(error);
  }
}

export async function deleteClientDispatch(
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requirePermission("client.manage");
  const id = String(formData.get("id") ?? "");

  const contact = await db.dispatchContact.findUnique({
    where: { id },
    select: { id: true, label: true, clientId: true },
  });
  // Only ones held against a company. A job's own numbers are the job's.
  if (!contact?.clientId) return { ok: false, error: "Not found." };

  await db.dispatchContact.delete({ where: { id } });

  await recordAudit({
    actorId: actor.id,
    entityType: "Client",
    entityId: contact.clientId,
    action: "updated",
    detail: { field: "dispatch contact", from: contact.label },
  });

  revalidatePath("/directory/clients");
  revalidatePath("/jobs/new");
  return { ok: true };
}

/** Removes an attachment and its bytes after a save that did not complete. */
async function deleteFileFor(attachmentId: string): Promise<void> {
  try {
    const attachment = await db.attachment.findUnique({
      where: { id: attachmentId },
      select: { storagePath: true },
    });
    if (attachment) await deleteFile(attachment.storagePath);
    await db.attachment.delete({ where: { id: attachmentId } });
  } catch {
    // Already gone, or the same fault that brought us here. Nothing useful
    // left to do, and throwing would replace a clear message with a digest.
  }
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
