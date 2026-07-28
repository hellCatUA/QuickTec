/*
  Warnings:

  - You are about to drop the column `externalAssignmentId` on the `JobAssignment` table. All the data in the column will be lost.
  - You are about to drop the column `approvedAt` on the `MileageEntry` table. All the data in the column will be lost.
  - You are about to drop the column `approvedById` on the `MileageEntry` table. All the data in the column will be lost.
  - You are about to drop the column `payrollLineId` on the `MileageEntry` table. All the data in the column will be lost.
  - You are about to drop the column `status` on the `MileageEntry` table. All the data in the column will be lost.
  - Added the required column `intWoSequence` to the `Job` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "MileageEntry" DROP CONSTRAINT "MileageEntry_approvedById_fkey";

-- DropForeignKey
ALTER TABLE "MileageEntry" DROP CONSTRAINT "MileageEntry_payrollLineId_fkey";

-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "externalAssignmentId" TEXT,
ADD COLUMN     "intWoSequence" INTEGER NOT NULL;

-- AlterTable
ALTER TABLE "JobAssignment" DROP COLUMN "externalAssignmentId";

-- AlterTable
ALTER TABLE "MileageEntry" DROP COLUMN "approvedAt",
DROP COLUMN "approvedById",
DROP COLUMN "payrollLineId",
DROP COLUMN "status";
