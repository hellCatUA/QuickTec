-- A profile picture is Public by default. What the company decides is whether
-- a person may keep theirs to the company — the other way round from before,
-- when it was kept to the company unless the person made it Public.

ALTER TABLE "ProfilePrivacy" RENAME COLUMN "allowPublic" TO "allowChoice";

-- A company that had set pictures to Public had set them Public for everyone,
-- with nothing for the person to choose: kept so. A narrower level stays as
-- it was, where the switch no longer matters.
UPDATE "ProfilePrivacy"
SET "allowChoice" = CASE WHEN "level" = 'PUBLIC' THEN false ELSE NULL END
WHERE "field" = 'picture';

ALTER TABLE "User" ALTER COLUMN "avatarVisibility" SET DEFAULT 'PUBLIC';

-- Everybody left on the old default goes to the new one. Somebody who chose
-- to keep their picture to the company — their history says so — keeps it
-- there.
UPDATE "User" u SET "avatarVisibility" = 'PUBLIC'
WHERE "avatarVisibility" <> 'PUBLIC' AND NOT EXISTS (
  SELECT 1 FROM "AuditEvent" e
  WHERE e."entityType" = 'User' AND e."entityId" = u."id"
    AND e."action" = 'profile.changed'
    AND e."detail"->>'field' = 'picture'
    AND e."detail"->>'to' IN ('Federated', 'Shown to Federated', 'Restricted', 'Shown to Restricted')
);
