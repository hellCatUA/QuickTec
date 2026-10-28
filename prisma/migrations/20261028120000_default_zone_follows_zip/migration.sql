-- The zone every account starts with, left beside a ZIP on another clock,
-- was never picked: nobody chose it, it was just there. From now on such a
-- zone follows the ZIP, as any other unpicked zone does; this moves the ones
-- already there to the zone their ZIP is in, and says so on each person's
-- history, as QuickTec's doing.
--
-- The ZIP-to-zone table is the app's own (src/lib/us-regions.ts), written out
-- here once: the first three digits of the ZIP, American Samoa apart.
WITH zip AS (
  SELECT
    u."id",
    u."postalCode",
    regexp_replace(u."postalCode", '\D', '', 'g') AS digits
  FROM "User" u
  WHERE u."timeZoneManual" = false
    AND u."timeZone" = 'America/Los_Angeles'
    AND u."postalCode" IS NOT NULL
),
z AS (
  SELECT "id", "postalCode", digits, substr(digits, 1, 3)::int AS prefix
  FROM zip
  WHERE length(digits) >= 5
),
moved AS (
  SELECT "id", "postalCode",
    CASE
      WHEN z.digits LIKE '96799%' THEN 'Pacific/Pago_Pago'
      WHEN z.prefix BETWEEN 5 AND 5 THEN 'America/New_York'
      WHEN z.prefix BETWEEN 6 AND 9 THEN 'America/Puerto_Rico'
      WHEN z.prefix BETWEEN 10 AND 323 THEN 'America/New_York'
      WHEN z.prefix BETWEEN 324 AND 325 THEN 'America/Chicago'
      WHEN z.prefix BETWEEN 326 AND 349 THEN 'America/New_York'
      WHEN z.prefix BETWEEN 350 AND 372 THEN 'America/Chicago'
      WHEN z.prefix BETWEEN 373 AND 374 THEN 'America/New_York'
      WHEN z.prefix BETWEEN 375 AND 375 THEN 'America/Chicago'
      WHEN z.prefix BETWEEN 376 AND 379 THEN 'America/New_York'
      WHEN z.prefix BETWEEN 380 AND 397 THEN 'America/Chicago'
      WHEN z.prefix BETWEEN 398 AND 419 THEN 'America/New_York'
      WHEN z.prefix BETWEEN 420 AND 424 THEN 'America/Chicago'
      WHEN z.prefix BETWEEN 425 AND 426 THEN 'America/New_York'
      WHEN z.prefix BETWEEN 427 AND 427 THEN 'America/Chicago'
      WHEN z.prefix BETWEEN 430 AND 462 THEN 'America/New_York'
      WHEN z.prefix BETWEEN 463 AND 464 THEN 'America/Chicago'
      WHEN z.prefix BETWEEN 465 AND 475 THEN 'America/New_York'
      WHEN z.prefix BETWEEN 476 AND 477 THEN 'America/Chicago'
      WHEN z.prefix BETWEEN 478 AND 499 THEN 'America/New_York'
      WHEN z.prefix BETWEEN 500 AND 576 THEN 'America/Chicago'
      WHEN z.prefix BETWEEN 577 AND 577 THEN 'America/Denver'
      WHEN z.prefix BETWEEN 578 AND 585 THEN 'America/Chicago'
      WHEN z.prefix BETWEEN 586 AND 586 THEN 'America/Denver'
      WHEN z.prefix BETWEEN 587 AND 588 THEN 'America/Chicago'
      WHEN z.prefix BETWEEN 590 AND 599 THEN 'America/Denver'
      WHEN z.prefix BETWEEN 600 AND 676 THEN 'America/Chicago'
      WHEN z.prefix BETWEEN 677 AND 677 THEN 'America/Denver'
      WHEN z.prefix BETWEEN 678 AND 692 THEN 'America/Chicago'
      WHEN z.prefix BETWEEN 693 AND 693 THEN 'America/Denver'
      WHEN z.prefix BETWEEN 700 AND 797 THEN 'America/Chicago'
      WHEN z.prefix BETWEEN 798 AND 834 THEN 'America/Denver'
      WHEN z.prefix BETWEEN 835 AND 835 THEN 'America/Los_Angeles'
      WHEN z.prefix BETWEEN 836 AND 837 THEN 'America/Denver'
      WHEN z.prefix BETWEEN 838 AND 838 THEN 'America/Los_Angeles'
      WHEN z.prefix BETWEEN 840 AND 847 THEN 'America/Denver'
      WHEN z.prefix BETWEEN 850 AND 865 THEN 'America/Phoenix'
      WHEN z.prefix BETWEEN 870 AND 885 THEN 'America/Denver'
      WHEN z.prefix BETWEEN 889 AND 961 THEN 'America/Los_Angeles'
      WHEN z.prefix BETWEEN 967 AND 968 THEN 'Pacific/Honolulu'
      WHEN z.prefix BETWEEN 969 AND 969 THEN 'Pacific/Guam'
      WHEN z.prefix BETWEEN 970 AND 994 THEN 'America/Los_Angeles'
      WHEN z.prefix BETWEEN 995 AND 999 THEN 'America/Anchorage'
    END AS zone
  FROM z
),
updated AS (
  UPDATE "User" u
  SET "timeZone" = moved.zone
  FROM moved
  WHERE u."id" = moved."id"
    AND moved.zone IS NOT NULL
    AND moved.zone <> 'America/Los_Angeles'
  RETURNING u."id", moved.zone, moved."postalCode"
)
INSERT INTO "AuditEvent" ("id", "actorId", "entityType", "entityId", "action", "detail", "createdAt")
SELECT
  'tz' || md5(updated."id" || '20261028120000'),
  NULL,
  'User',
  updated."id",
  'profile.changed',
  jsonb_build_object(
    'field', 'timeZone',
    'from', 'Default: Pacific',
    'to', 'Auto (ZIP): ' || CASE updated.zone
      WHEN 'America/New_York' THEN 'Eastern'
      WHEN 'America/Puerto_Rico' THEN 'Atlantic — Puerto Rico, USVI'
      WHEN 'America/Chicago' THEN 'Central'
      WHEN 'America/Denver' THEN 'Mountain'
      WHEN 'America/Los_Angeles' THEN 'Pacific'
      WHEN 'America/Phoenix' THEN 'Arizona — no daylight saving'
      WHEN 'Pacific/Honolulu' THEN 'Hawaii — no daylight saving'
      WHEN 'Pacific/Guam' THEN 'Chamorro — Guam, Northern Marianas'
      WHEN 'America/Anchorage' THEN 'Alaska'
      WHEN 'Pacific/Pago_Pago' THEN 'Samoa'
      ELSE updated.zone
    END,
    'source', trim('Auto: ZIP ' || updated."postalCode")
  ),
  CURRENT_TIMESTAMP
FROM updated;
