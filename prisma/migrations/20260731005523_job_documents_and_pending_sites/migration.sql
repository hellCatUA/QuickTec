-- The work order is no longer the only piece of the representing company's
-- paperwork that hangs off a job, so the column is renamed rather than
-- replaced and every row already filed is marked as what it always was.
CREATE TYPE "JobDocumentKind" AS ENUM ('CLIENT_WORK_ORDER', 'SIGN_OFF');

ALTER TABLE "Attachment" RENAME COLUMN "workOrderJobId" TO "jobDocumentId";
ALTER TABLE "Attachment" ADD COLUMN "jobDocumentKind" "JobDocumentKind";
UPDATE "Attachment"
   SET "jobDocumentKind" = 'CLIENT_WORK_ORDER'
 WHERE "jobDocumentId" IS NOT NULL;

ALTER TABLE "Attachment" RENAME CONSTRAINT "Attachment_workOrderJobId_fkey" TO "Attachment_jobDocumentId_fkey";
ALTER INDEX "Attachment_workOrderJobId_idx" RENAME TO "Attachment_jobDocumentId_idx";

-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "noWorkOrder" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Site" ADD COLUMN     "numberPending" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ClientDocumentTemplate" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "kind" "JobDocumentKind" NOT NULL,
    "label" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "attachmentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientDocumentTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClientDocumentTemplate_attachmentId_key" ON "ClientDocumentTemplate"("attachmentId");

-- CreateIndex
CREATE INDEX "ClientDocumentTemplate_clientId_kind_idx" ON "ClientDocumentTemplate"("clientId", "kind");

-- AddForeignKey
ALTER TABLE "ClientDocumentTemplate" ADD CONSTRAINT "ClientDocumentTemplate_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientDocumentTemplate" ADD CONSTRAINT "ClientDocumentTemplate_attachmentId_fkey" FOREIGN KEY ("attachmentId") REFERENCES "Attachment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
