-- CreateEnum
CREATE TYPE "PrivacyLevel" AS ENUM ('RESTRICTED', 'FEDERATED', 'PUBLIC');

-- CreateEnum
CREATE TYPE "PreferredPhone" AS ENUM ('PERSONAL', 'WORK', 'VOIP');

-- CreateEnum
CREATE TYPE "ProfileRequestField" AS ENUM ('LEGAL_NAME', 'PICTURE');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "avatarPath" TEXT,
ADD COLUMN     "avatarVisibility" "PrivacyLevel" NOT NULL DEFAULT 'FEDERATED',
ADD COLUMN     "preferredPhone" "PreferredPhone",
ADD COLUMN     "primaryRegion" TEXT,
ADD COLUMN     "serviceStartDate" DATE,
ADD COLUMN     "statesOfOperation" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "timeZoneManual" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "voipPhone" TEXT,
ADD COLUMN     "workPhone" TEXT;

-- CreateTable
CREATE TABLE "ProfilePrivacy" (
    "field" TEXT NOT NULL,
    "level" "PrivacyLevel" NOT NULL,
    "allowPublic" BOOLEAN,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProfilePrivacy_pkey" PRIMARY KEY ("field")
);

-- CreateTable
CREATE TABLE "ProfileRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "field" "ProfileRequestField" NOT NULL,
    "value" TEXT,
    "picturePath" TEXT,
    "requestedById" TEXT NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProfileRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProfileRequest_userId_status_idx" ON "ProfileRequest"("userId", "status");

-- CreateIndex
CREATE INDEX "ProfileRequest_status_idx" ON "ProfileRequest"("status");

-- AddForeignKey
ALTER TABLE "ProfileRequest" ADD CONSTRAINT "ProfileRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfileRequest" ADD CONSTRAINT "ProfileRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfileRequest" ADD CONSTRAINT "ProfileRequest_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

