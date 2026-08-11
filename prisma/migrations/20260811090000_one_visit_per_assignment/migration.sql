-- One job, one tech, one visit.
--
-- Clocking in only ever refused while a visit was still open, so clocking out
-- and back in on the same job silently opened a second one. That is not a
-- second trip — a real return visit is a revisit job, with its own number, its
-- own paperwork and its own line on an invoice. It was a mis-tap, or somebody
-- correcting a wrong clock-out the only way the app allowed.
--
-- Existing doubles are merged rather than dropped. The gap between the two
-- becomes an unpaid break, which makes the merge exactly neutral: paid time is
-- onsite minus unpaid breaks, so 09:00-12:00 plus 13:00-17:00 pays the same as
-- 09:00-17:00 with an hour off in the middle. The client's bill is the span
-- from the earliest clock-in to the latest clock-out either way, so that does
-- not move at all.
DO $$
DECLARE
  crowded    RECORD;
  keeper     "Visit"%ROWTYPE;
  extra      "Visit"%ROWTYPE;
  running_out TIMESTAMP(3);
BEGIN
  FOR crowded IN
    SELECT "assignmentId"
      FROM "Visit"
     GROUP BY "assignmentId"
    HAVING count(*) > 1
  LOOP
    SELECT * INTO keeper
      FROM "Visit"
     WHERE "assignmentId" = crowded."assignmentId"
     ORDER BY "clockInAt" ASC, "createdAt" ASC
     LIMIT 1;

    running_out := keeper."clockOutAt";

    FOR extra IN
      SELECT *
        FROM "Visit"
       WHERE "assignmentId" = crowded."assignmentId"
         AND id <> keeper.id
       ORDER BY "clockInAt" ASC, "createdAt" ASC
    LOOP
      -- The time between the trips was never paid, and must not start being
      -- paid because the two rows became one.
      IF running_out IS NOT NULL AND running_out < extra."clockInAt" THEN
        INSERT INTO "BreakPeriod" (id, "visitId", "startAt", "endAt", paid, "createdAt")
        VALUES (
          md5(random()::text || clock_timestamp()::text),
          keeper.id,
          running_out,
          extra."clockInAt",
          false,
          now()
        );
      END IF;

      UPDATE "BreakPeriod" SET "visitId" = keeper.id WHERE "visitId" = extra.id;

      -- The last clock-out wins, including a null one: somebody still on site
      -- stays on site.
      UPDATE "Visit"
         SET "clockOutAt"     = extra."clockOutAt",
             "clockOutSource" = extra."clockOutSource",
             "clockOutRawAt"  = extra."clockOutRawAt"
       WHERE id = keeper.id;

      running_out := extra."clockOutAt";

      DELETE FROM "Visit" WHERE id = extra.id;
    END LOOP;
  END LOOP;
END $$;

-- Enforced here rather than in the schema on purpose: declaring the column
-- unique would make Prisma read the relation as one-to-one and rename
-- `assignment.visits` throughout the app, which says nothing new and touches
-- everything. The database is where the rule has to hold.
CREATE UNIQUE INDEX "Visit_assignmentId_key" ON "Visit"("assignmentId");
