-- AlterTable
ALTER TABLE "JobFormEntry" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedById" TEXT,
ADD COLUMN     "approvedValue" TEXT,
ALTER COLUMN "value" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "JobFormEntry" ADD CONSTRAINT "JobFormEntry_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
