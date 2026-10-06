-- Our own project ID, and the paying / rep company's names and IDs for it.
--
-- The INT WO number used to carry the paying company's project ID, or 0000
-- when there was none — so two projects without one, each with its own
-- counter, issued the same numbers and the second job could not be created.
-- It now carries ours, which is required and unique.

ALTER TABLE "Project" ADD COLUMN "code" TEXT;
ALTER TABLE "Project" ADD COLUMN "clientProjectName" TEXT;
ALTER TABLE "Project" ADD COLUMN "repProjectName" TEXT;
ALTER TABLE "Project" ADD COLUMN "repProjectId" TEXT;

-- Existing projects keep the reference their jobs are already numbered with
-- where it can serve as ours: upper case, letters, digits and dashes, not
-- 0000, and not already taken by an older project. Anything else is given
-- the next free P001, P002 …
DO $$
DECLARE
  project RECORD;
  candidate TEXT;
  counter INT := 0;
BEGIN
  FOR project IN SELECT "id", "externalProjectId" FROM "Project" ORDER BY "createdAt", "id" LOOP
    candidate := upper(btrim(coalesce(project."externalProjectId", '')));
    IF candidate !~ '^[A-Z0-9][A-Z0-9-]{0,19}$'
       OR candidate = '0000'
       OR EXISTS (SELECT 1 FROM "Project" WHERE "code" = candidate) THEN
      LOOP
        counter := counter + 1;
        candidate := 'P' || lpad(counter::text, 3, '0');
        EXIT WHEN NOT EXISTS (SELECT 1 FROM "Project" WHERE "code" = candidate)
          AND NOT EXISTS (
            SELECT 1 FROM "Project"
            WHERE upper(btrim(coalesce("externalProjectId", ''))) = candidate
          );
      END LOOP;
    END IF;
    UPDATE "Project" SET "code" = candidate WHERE "id" = project."id";
  END LOOP;
END $$;

ALTER TABLE "Project" ALTER COLUMN "code" SET NOT NULL;
CREATE UNIQUE INDEX "Project_code_key" ON "Project"("code");
