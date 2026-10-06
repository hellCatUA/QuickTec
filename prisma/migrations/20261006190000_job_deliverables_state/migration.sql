-- Whether a job's deliverable sheet is its own and whether it has been fixed
-- at checkout, stored rather than guessed from where the job is in its life:
-- a job can be clocked into again after the last clock-out, or have its time
-- removed, and a guess from the lifecycle then called a frozen copy "changed
-- for this job".
ALTER TABLE "Job"
  ADD COLUMN "deliverablesOwn" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "deliverablesFrozenAt" TIMESTAMP(3);

-- An open job with rows has had them changed for itself: the jobs that merely
-- copied their project's sheet were let go to follow it by the previous
-- migration.
UPDATE "Job" j
   SET "deliverablesOwn" = true
 WHERE j."lifecycle"::text IN ('DRAFT', 'PENDING_APPROVAL', 'SCHEDULED', 'IN_PROGRESS')
   AND EXISTS (SELECT 1 FROM "DeliverableRequirement" r WHERE r."jobId" = j."id");

-- Past checkout: fixed. Their rows are kept as their own as well, so that if
-- one is worked again it keeps the sheet it had rather than losing it.
UPDATE "Job" j
   SET "deliverablesFrozenAt" = CURRENT_TIMESTAMP,
       "deliverablesOwn" = EXISTS (SELECT 1 FROM "DeliverableRequirement" r WHERE r."jobId" = j."id")
 WHERE j."lifecycle"::text NOT IN ('DRAFT', 'PENDING_APPROVAL', 'SCHEDULED', 'IN_PROGRESS');
