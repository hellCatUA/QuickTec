-- AlterTable
ALTER TABLE "ProfileRequest" ADD COLUMN     "reason" TEXT;

-- CreateTable
CREATE TABLE "ProfilePicture" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "addedById" TEXT,
    "approvedById" TEXT,
    "approvedBySystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProfilePicture_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProfilePicture_path_key" ON "ProfilePicture"("path");

-- CreateIndex
CREATE INDEX "ProfilePicture_userId_createdAt_idx" ON "ProfilePicture"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "ProfilePicture" ADD CONSTRAINT "ProfilePicture_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfilePicture" ADD CONSTRAINT "ProfilePicture_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfilePicture" ADD CONSTRAINT "ProfilePicture_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Every picture somebody carries now is the first in their archive. Where it
-- came from is read off the history: copied from NextCloud, or put up here.
INSERT INTO "ProfilePicture" ("id", "userId", "path", "source", "approvedBySystem", "createdAt")
SELECT
  'pp' || md5(u."id" || u."avatarPath"),
  u."id",
  u."avatarPath",
  CASE WHEN imported.yes THEN 'Auto-Import: NC' ELSE 'Manual Import' END,
  imported.yes,
  COALESCE(u."pictureSetAt", CURRENT_TIMESTAMP)
FROM "User" u
CROSS JOIN LATERAL (
  SELECT EXISTS (
    SELECT 1 FROM "AuditEvent" e
    WHERE e."entityType" = 'User' AND e."entityId" = u."id"
      AND e."action" = 'profile.imported' AND e."detail"->>'field' = 'picture'
  ) AS yes
) imported
WHERE u."avatarPath" IS NOT NULL;
