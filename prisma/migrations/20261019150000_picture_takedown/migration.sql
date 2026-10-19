-- AlterTable
ALTER TABLE "ProfilePicture" ADD COLUMN     "takenDownAt" TIMESTAMP(3),
ADD COLUMN     "takenDownById" TEXT;


-- The archive's first rows were filled in from whether a NextCloud copy had
-- ever happened. Read them again from the latest picture event of each
-- person — who put the current picture up, from where, and who approved it.
UPDATE "ProfilePicture" p
SET
  "source" = CASE
    WHEN latest."action" = 'profile.imported' THEN 'Auto-Import: NC'
    WHEN COALESCE(latest."detail"->>'to', '') ILIKE '%Photo ID%' THEN 'Manual Import: ID'
    WHEN latest."action" = 'profile.approved' THEN 'Manual Import: ' || subject."name"
    WHEN actor."name" IS NOT NULL THEN 'Manual Import: ' || actor."name"
    ELSE p."source"
  END,
  "addedById" = CASE
    WHEN latest."action" = 'profile.imported' THEN NULL
    WHEN latest."action" = 'profile.approved' THEN p."userId"
    ELSE latest."actorId"
  END,
  "approvedById" = CASE WHEN latest."action" = 'profile.approved' THEN latest."actorId" ELSE NULL END,
  "approvedBySystem" = (latest."action" = 'profile.imported')
FROM "User" subject
CROSS JOIN LATERAL (
  SELECT e."action", e."actorId", e."detail"
  FROM "AuditEvent" e
  WHERE e."entityType" = 'User' AND e."entityId" = subject."id"
    AND e."action" IN ('profile.imported', 'profile.approved', 'profile.changed')
    AND e."detail"->>'field' = 'picture'
    AND e."detail"->>'to' IS NOT NULL
    AND e."detail"->>'to' NOT LIKE 'Shown to %'
    AND e."detail"->>'to' NOT IN ('Public', 'Federated', 'Restricted')
  ORDER BY e."createdAt" DESC
  LIMIT 1
) latest
LEFT JOIN "User" actor ON actor."id" = latest."actorId"
WHERE p."userId" = subject."id" AND p."id" LIKE 'pp%';
