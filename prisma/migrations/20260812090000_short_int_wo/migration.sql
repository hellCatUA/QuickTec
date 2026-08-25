-- Shorten the internal work order number: YYYY-MM-… becomes YYMM-….
--
-- The numbers already issued are rewritten rather than left in the old shape.
-- This is a way of writing the number, not a different number: the year, the
-- month, the project and the sequence are all still there, and a job that read
-- 2026-08-0000-0017 reads 2608-0000-0017. Leaving the old ones alone would mean
-- two formats in one list, sorting apart from each other, for no gain — the
-- century was never the part anybody needed.
--
-- Matched strictly on a four-digit year and two-digit month at the front, so a
-- number already in the new shape is left alone and this can be re-run.
UPDATE "Job"
SET "intWoId" =
  substring("intWoId" from 3 for 2) ||
  substring("intWoId" from 6 for 2) ||
  substring("intWoId" from 8)
WHERE "intWoId" ~ '^[0-9]{4}-[0-9]{2}-';
