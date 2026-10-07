-- A revisit copies its job's rooms as it is raised, so the previous step saw
-- those copies as planned. A room the crew found on the original job is one
-- they found on its revisits too: the copies stop owing photos with it, down
-- a chain of revisits however long. Only a requirement is lifted.
DO $$
DECLARE
  changed integer;
BEGIN
  LOOP
    UPDATE "JobLocation" AS child
    SET "counted" = false
    FROM "Job" AS job, "JobLocation" AS parent
    WHERE child."jobId" = job."id"
      AND job."parentJobId" IS NOT NULL
      AND parent."jobId" = job."parentJobId"
      AND lower(parent."name") = lower(child."name")
      AND parent."counted" = false
      AND child."counted" = true
      AND child."createdAt" <= job."createdAt" + INTERVAL '1 minute';
    GET DIAGNOSTICS changed = ROW_COUNT;
    EXIT WHEN changed = 0;
  END LOOP;
END $$;
