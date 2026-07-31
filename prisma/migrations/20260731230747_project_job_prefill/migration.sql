-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "defaultJobTitle" TEXT,
ADD COLUMN     "defaultPayRate" DECIMAL(10,2),
ADD COLUMN     "defaultPayType" "PayType";
