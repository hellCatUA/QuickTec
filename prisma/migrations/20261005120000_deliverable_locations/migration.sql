-- How many photos a section needs, whether it is counted at each location,
-- and a note for the crew. Existing sections keep behaving as they did: one
-- photo is enough, wherever it was taken.
ALTER TABLE "DeliverableRequirement"
  ADD COLUMN "minPhotos" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "perLocation" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "note" TEXT;

-- The places on site a job's photos are filed under.
CREATE TABLE "JobLocation" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobLocation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "JobLocation_jobId_name_key" ON "JobLocation"("jobId", "name");
CREATE INDEX "JobLocation_jobId_idx" ON "JobLocation"("jobId");

ALTER TABLE "JobLocation" ADD CONSTRAINT "JobLocation_jobId_fkey"
  FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DeliverableItem" ADD COLUMN "locationId" TEXT;

CREATE INDEX "DeliverableItem_locationId_idx" ON "DeliverableItem"("locationId");

ALTER TABLE "DeliverableItem" ADD CONSTRAINT "DeliverableItem_locationId_fkey"
  FOREIGN KEY ("locationId") REFERENCES "JobLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
