-- CreateEnum
CREATE TYPE "SignInMethod" AS ENUM ('SSO', 'LOCAL');

-- One visit per assignment, kept — but as a partial index.
--
-- A plain unique index is something Prisma can express, so it diffs against
-- the schema, does not find it there, and drops it on the next migration.
-- Declaring it in the schema is not the answer either: a unique foreign key
-- makes Prisma read the relation as one-to-one and rename `assignment.visits`
-- across the whole app.
--
-- A partial index is not expressible, so Prisma leaves it alone — the same
-- reason the DeliverableRequirement indexes survive. The predicate is true for
-- every row, because the column is NOT NULL, so the guarantee is unchanged and
-- still enforced atomically by the database rather than by a check-then-insert.
DROP INDEX IF EXISTS "Visit_assignmentId_key";

CREATE UNIQUE INDEX "Visit_assignmentId_key"
  ON "Visit"("assignmentId")
  WHERE "assignmentId" IS NOT NULL;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "failedSignIns" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lockedUntil" TIMESTAMP(3),
ADD COLUMN     "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "passwordHash" TEXT,
ADD COLUMN     "signInMethod" "SignInMethod" NOT NULL DEFAULT 'SSO';

-- CreateTable
CREATE TABLE "PasswordSetupToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordSetupToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PasswordSetupToken_tokenHash_key" ON "PasswordSetupToken"("tokenHash");

-- CreateIndex
CREATE INDEX "PasswordSetupToken_userId_idx" ON "PasswordSetupToken"("userId");

-- AddForeignKey
ALTER TABLE "PasswordSetupToken" ADD CONSTRAINT "PasswordSetupToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
