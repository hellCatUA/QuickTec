-- When a legal name and a picture were first set. After that a person asks
-- for a change rather than making it, even once the value has been cleared.
ALTER TABLE "User" ADD COLUMN "legalNameSetAt" TIMESTAMP(3),
ADD COLUMN "pictureSetAt" TIMESTAMP(3);

-- Whatever is already there was set at some point; the profile history says
-- when, where it can.
UPDATE "User" SET "legalNameSetAt" = CURRENT_TIMESTAMP WHERE "legalName" IS NOT NULL;
UPDATE "User" SET "pictureSetAt" = CURRENT_TIMESTAMP WHERE "avatarPath" IS NOT NULL;
UPDATE "User" u SET "pictureSetAt" = CURRENT_TIMESTAMP
WHERE "pictureSetAt" IS NULL AND EXISTS (
  SELECT 1 FROM "AuditEvent" e
  WHERE e."entityType" = 'User' AND e."entityId" = u."id"
    AND e."action" IN ('profile.changed', 'profile.imported', 'profile.approved')
    AND e."detail"->>'field' = 'picture'
    AND COALESCE(e."detail"->>'to', '') NOT LIKE 'Shown to %'
    AND COALESCE(e."detail"->>'from', '') NOT LIKE 'Shown to %'
);
