-- "MDF" and "mdf" are one room. The app refuses the second already, but two
-- people adding it at the same moment both passed that check, and the index
-- below — which Prisma cannot express, so it lives here — closes the gap.
--
-- Any pair that slipped through is merged first: the photos of the later one
-- move to the earlier, and the later one goes.
WITH ranked AS (
  SELECT "id",
         first_value("id") OVER (
           PARTITION BY "jobId", lower("name")
           ORDER BY "createdAt", "id"
         ) AS keep
    FROM "JobLocation"
)
UPDATE "DeliverableItem" i
   SET "locationId" = r.keep
  FROM ranked r
 WHERE i."locationId" = r."id"
   AND r."id" <> r.keep;

WITH ranked AS (
  SELECT "id",
         first_value("id") OVER (
           PARTITION BY "jobId", lower("name")
           ORDER BY "createdAt", "id"
         ) AS keep
    FROM "JobLocation"
)
DELETE FROM "JobLocation" l
 USING ranked r
 WHERE l."id" = r."id"
   AND r."id" <> r.keep;

CREATE UNIQUE INDEX "JobLocation_jobId_lower_name_key"
    ON "JobLocation" ("jobId", lower("name"));
