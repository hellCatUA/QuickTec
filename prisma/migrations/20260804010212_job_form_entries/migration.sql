-- CreateTable
CREATE TABLE "JobFormEntry" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "placementId" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobFormEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JobFormEntry_jobId_idx" ON "JobFormEntry"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "JobFormEntry_jobId_placementId_key" ON "JobFormEntry"("jobId", "placementId");

-- AddForeignKey
ALTER TABLE "JobFormEntry" ADD CONSTRAINT "JobFormEntry_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobFormEntry" ADD CONSTRAINT "JobFormEntry_placementId_fkey" FOREIGN KEY ("placementId") REFERENCES "FormPlacement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
