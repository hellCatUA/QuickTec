-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "payRate" DECIMAL(10,2),
ADD COLUMN     "payType" "PayType",
ADD COLUMN     "travelReimbursement" DECIMAL(10,2);

-- AlterTable
ALTER TABLE "JobAssignment" ADD COLUMN     "payOverridden" BOOLEAN NOT NULL DEFAULT false;
