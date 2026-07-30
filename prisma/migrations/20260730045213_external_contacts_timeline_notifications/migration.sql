/*
  Warnings:

  - You are about to drop the column `readAt` on the `Notification` table. All the data in the column will be lost.

*/
-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "JobLifecycle" ADD VALUE 'BILLED';
ALTER TYPE "JobLifecycle" ADD VALUE 'CLOSED';

-- DropIndex
DROP INDEX "Notification_userId_readAt_idx";

-- AlterTable
ALTER TABLE "AuditEvent" ADD COLUMN     "projectId" TEXT;

-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "billedAt" TIMESTAMP(3),
ADD COLUMN     "closedAt" TIMESTAMP(3),
ADD COLUMN     "pmContactId" TEXT;

-- AlterTable
ALTER TABLE "Notification" DROP COLUMN "readAt",
ADD COLUMN     "acknowledgedAt" TIMESTAMP(3),
ADD COLUMN     "actorId" TEXT,
ADD COLUMN     "jobId" TEXT,
ADD COLUMN     "projectId" TEXT;

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "pmContactId" TEXT;

-- CreateTable
CREATE TABLE "ExternalContact" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "notes" TEXT,
    "clientId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectPmChange" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "contactId" TEXT,
    "changedById" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectPmChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExternalContact_name_idx" ON "ExternalContact"("name");

-- CreateIndex
CREATE INDEX "ExternalContact_clientId_idx" ON "ExternalContact"("clientId");

-- CreateIndex
CREATE INDEX "ProjectPmChange_projectId_createdAt_idx" ON "ProjectPmChange"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_projectId_createdAt_idx" ON "AuditEvent"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_userId_acknowledgedAt_idx" ON "Notification"("userId", "acknowledgedAt");

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_pmContactId_fkey" FOREIGN KEY ("pmContactId") REFERENCES "ExternalContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalContact" ADD CONSTRAINT "ExternalContact_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectPmChange" ADD CONSTRAINT "ProjectPmChange_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectPmChange" ADD CONSTRAINT "ProjectPmChange_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "ExternalContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectPmChange" ADD CONSTRAINT "ProjectPmChange_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_pmContactId_fkey" FOREIGN KEY ("pmContactId") REFERENCES "ExternalContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
