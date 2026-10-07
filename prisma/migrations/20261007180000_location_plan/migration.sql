-- Which fields a location is photographed in, whether it owes them their
-- photo count, and counts set for it alone.

-- AlterTable
ALTER TABLE "JobLocation" ADD COLUMN     "counted" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "fields" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "minPhotos" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "ProjectLocation" ADD COLUMN     "fields" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "minPhotos" JSONB NOT NULL DEFAULT '{}';

-- Every location so far is in every field, as it was. The ones a tech added
-- on site stop owing photos, as rooms added on site do from now on: added by
-- a tech after the job was raised, rather than copied onto it with the job
-- from its project or the job it revisits, which happens as the job is made.
-- Only a requirement is lifted, so no job is held up by this.
UPDATE "JobLocation" AS location
SET "counted" = false
FROM "Job" AS job, "User" AS author
WHERE location."jobId" = job."id"
  AND author."id" = location."createdById"
  AND author."baseRole" = 'TECH'
  AND location."createdAt" > job."createdAt" + INTERVAL '1 minute';
