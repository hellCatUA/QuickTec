-- Shorten the internal work order number: YYYY-MM-… becomes YYMM-….
--
-- The numbers already issued are rewritten rather than left in the old shape.
-- This is a way of writing the number, not a different number: the year, the
-- month, the project and the sequence are all still there, and a job that read
-- 2026-08-0000-0017 reads 2608-0000-0017. Leaving the old ones alone would mean
-- two formats in one list, sorting apart from each other, for no gain — the
-- century was never the part anybody needed.
--
-- Matched on a four-digit year, a two-digit month, and then a project ref that
-- is NOT itself two digits followed by a dash. Without that last part a client
-- whose project ID happens to be two digits would produce 2608-12-0042, which
-- looks exactly like an unconverted number, and a second run would chew it
-- down to 0812-0042. externalProjectId is free text, so that is possible.
UPDATE "Job"
SET "intWoId" =
  substring("intWoId" from 3 for 2) ||
  substring("intWoId" from 6 for 2) ||
  substring("intWoId" from 8)
WHERE "intWoId" ~ '^[0-9]{4}-[0-9]{2}-' AND "intWoId" !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}-';
