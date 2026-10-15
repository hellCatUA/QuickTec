-- A legal name that was set and has since been cleared was still set once:
-- the next one is asked for. The first backfill read only the names still
-- there; this reads the history for the rest — profile events, and the users
-- page's diffs from before profiles existed.
UPDATE "User" u SET "legalNameSetAt" = CURRENT_TIMESTAMP
WHERE "legalNameSetAt" IS NULL AND EXISTS (
  SELECT 1 FROM "AuditEvent" e
  WHERE e."entityType" = 'User' AND e."entityId" = u."id"
    AND (
      (e."action" IN ('profile.changed', 'profile.approved')
        AND e."detail"->>'field' = 'legalName'
        AND e."detail"->>'to' IS NOT NULL)
      OR (e."action" IN ('updated', 'contact_updated') AND e."detail" ? 'legalName')
    )
);
