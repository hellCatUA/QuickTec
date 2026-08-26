-- Shorten the internal work order number: YYYY-MM-… becomes YYMM-….
--
-- The numbers already issued are rewritten rather than left in the old shape.
-- This is a way of writing the number, not a different number: the year, the
-- month, the project and the sequence are all still there, and a job that read
-- 2026-08-0000-0017 reads 2608-0000-0017. Leaving the old ones alone would mean
-- two formats in one list, sorting apart from each other, for no gain — the
-- century was never the part anybody needed.
--
-- Which rows are the old shape.
--
-- Not "four digits, a dash, two digits, a dash": a number already converted
-- can look exactly like that when the client's project ID happens to be two
-- digits, since 2608-12-0042 is YYMM-12-0042. An earlier attempt at this guard
-- excluded three numeric groups instead, which got it backwards on both
-- counts — it corrupted 2608-12-0042 into 0812-0042 and stopped converting
-- 2026-08-12-0042 at all.
--
-- Two conditions settle it. The year must read as a year, which YYMM does not
-- unless the year is 2019 or 2020; and after YYYY-MM- there must be a further
-- dash, because the old shape always carries a project ref and a sequence
-- while the new one has only the sequence left. Together they also make this
-- safe to run twice, though Prisma runs it once.
UPDATE "Job"
SET "intWoId" =
  substring("intWoId" from 3 for 2) ||
  substring("intWoId" from 6 for 2) ||
  substring("intWoId" from 8)
WHERE "intWoId" ~ '^(19|20)[0-9]{2}-(0[1-9]|1[0-2])-'
  AND substring("intWoId" from 9) LIKE '%-%';
