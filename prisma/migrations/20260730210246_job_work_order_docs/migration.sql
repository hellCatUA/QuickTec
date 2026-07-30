-- AlterTable
ALTER TABLE "Attachment" ADD COLUMN     "workOrderJobId" TEXT;

-- CreateIndex
CREATE INDEX "Attachment_workOrderJobId_idx" ON "Attachment"("workOrderJobId");

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_workOrderJobId_fkey" FOREIGN KEY ("workOrderJobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
