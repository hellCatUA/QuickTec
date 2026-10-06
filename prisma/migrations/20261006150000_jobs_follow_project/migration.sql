-- Jobs now follow their project's deliverable sheet live until somebody
-- changes the sections on the job, and keep what they were checked out
-- against from checkout on. Until now every job under a project was given a
-- copy of the project's sheet the day it was raised. Two things put the data
-- in line with that, both once.

-- 1. Open jobs whose copy still asks for exactly what the project asks for
--    were never changed for themselves: the copy goes and they follow the
--    project. Compared on the sections that are on and what each one demands;
--    a job that differs in any of it was changed on purpose and keeps its own.
WITH open_jobs AS (
  SELECT j."id", j."projectId"
    FROM "Job" j
   WHERE j."projectId" IS NOT NULL
     AND j."lifecycle"::text IN ('DRAFT', 'PENDING_APPROVAL', 'SCHEDULED', 'IN_PROGRESS')
     AND EXISTS (SELECT 1 FROM "DeliverableRequirement" r WHERE r."jobId" = j."id")
     AND EXISTS (SELECT 1 FROM "DeliverableRequirement" p
                  WHERE p."projectId" = j."projectId" AND p."jobId" IS NULL)
),
job_sheet AS (
  SELECT r."jobId" AS owner, r."category"::text AS category,
         coalesce(r."customLabel", '') AS label, r."required", r."requiresPhoto",
         r."requiresText", r."minPhotos", r."perLocation", coalesce(r."note", '') AS note
    FROM "DeliverableRequirement" r
   WHERE r."jobId" IN (SELECT "id" FROM open_jobs)
     AND r."enabled"
     AND NOT (r."category"::text = 'CUSTOM' AND r."customLabel" IS NULL)
),
project_sheet AS (
  SELECT p."projectId" AS owner, p."category"::text AS category,
         coalesce(p."customLabel", '') AS label, p."required", p."requiresPhoto",
         p."requiresText", p."minPhotos", p."perLocation", coalesce(p."note", '') AS note
    FROM "DeliverableRequirement" p
   WHERE p."jobId" IS NULL
     AND p."projectId" IN (SELECT "projectId" FROM open_jobs)
     AND p."enabled"
     AND NOT (p."category"::text = 'CUSTOM' AND p."customLabel" IS NULL)
),
changed AS (
  SELECT o."id"
    FROM open_jobs o
   WHERE EXISTS (
           SELECT category, label, "required", "requiresPhoto", "requiresText", "minPhotos", "perLocation", note
             FROM job_sheet WHERE owner = o."id"
           EXCEPT
           SELECT category, label, "required", "requiresPhoto", "requiresText", "minPhotos", "perLocation", note
             FROM project_sheet WHERE owner = o."projectId")
      OR EXISTS (
           SELECT category, label, "required", "requiresPhoto", "requiresText", "minPhotos", "perLocation", note
             FROM project_sheet WHERE owner = o."projectId"
           EXCEPT
           SELECT category, label, "required", "requiresPhoto", "requiresText", "minPhotos", "perLocation", note
             FROM job_sheet WHERE owner = o."id")
)
DELETE FROM "DeliverableRequirement"
 WHERE "jobId" IN (SELECT "id" FROM open_jobs WHERE "id" NOT IN (SELECT "id" FROM changed));

-- 2. Jobs already past checkout with no sheet of their own were following
--    their project or the defaults. They are given that sheet now, so a later
--    edit to the project cannot change what a finished job is read against.
INSERT INTO "DeliverableRequirement"
  ("id", "jobId", "category", "customLabel", "enabled", "required", "requiresPhoto",
   "requiresText", "minPhotos", "perLocation", "note", "order")
SELECT gen_random_uuid()::text, j."id", p."category", p."customLabel", p."enabled", p."required",
       p."requiresPhoto", p."requiresText", p."minPhotos", p."perLocation", p."note", p."order"
  FROM "Job" j
  JOIN "DeliverableRequirement" p ON p."projectId" = j."projectId" AND p."jobId" IS NULL
 WHERE j."lifecycle"::text NOT IN ('DRAFT', 'PENDING_APPROVAL', 'SCHEDULED', 'IN_PROGRESS')
   AND NOT EXISTS (SELECT 1 FROM "DeliverableRequirement" r WHERE r."jobId" = j."id")
   AND NOT (p."category"::text = 'CUSTOM' AND p."customLabel" IS NULL);

-- The rest — no project, or a project nothing was saved on — were answering
-- to the two standard sections.
INSERT INTO "DeliverableRequirement"
  ("id", "jobId", "category", "enabled", "required", "requiresPhoto", "requiresText",
   "minPhotos", "perLocation", "order")
SELECT gen_random_uuid()::text, j."id", d.category::"DeliverableCategory", true, true, true,
       false, 1, false, d.position
  FROM "Job" j
 CROSS JOIN (VALUES ('PRE_INSTALL', 0), ('POST_INSTALL', 1)) AS d(category, position)
 WHERE j."lifecycle"::text NOT IN ('DRAFT', 'PENDING_APPROVAL', 'SCHEDULED', 'IN_PROGRESS')
   AND NOT EXISTS (SELECT 1 FROM "DeliverableRequirement" r WHERE r."jobId" = j."id")
   AND NOT EXISTS (SELECT 1 FROM "DeliverableRequirement" p
                    WHERE p."projectId" = j."projectId" AND p."jobId" IS NULL);
