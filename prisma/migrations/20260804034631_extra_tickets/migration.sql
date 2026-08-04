-- CreateTable
CREATE TABLE "JobTicket" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobTicket_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JobTicket_jobId_order_idx" ON "JobTicket"("jobId", "order");

-- AddForeignKey
ALTER TABLE "JobTicket" ADD CONSTRAINT "JobTicket_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
