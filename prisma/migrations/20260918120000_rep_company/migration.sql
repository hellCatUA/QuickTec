-- The link between the customer and the paying company.
--
-- A job comes down customer -> rep company -> paying company -> WorkMarket ->
-- us. The paying company is the model still called Client, which is what the
-- app labelled "Rep Company" until that name was needed for this.
--
-- Both foreign keys are nullable on purpose. Every job and project that
-- already exists was raised without a rep company, and a NOT NULL column would
-- mean inventing a value for all of them — a backfill nobody could check.
-- ON DELETE SET NULL for the same reason: removing a rep company is a
-- directory tidy-up, not a reason to refuse to delete or to orphan a job.
--
-- Deliberately thin. No templates, no dispatch numbers, no pay rates: adding
-- it to PayRate would turn @@unique([userId, projectId, clientId]) into a
-- four-column key, which is a real migration on the constraint payroll reads
-- rates through, and buys nothing anyone has asked for.

-- CreateTable
CREATE TABLE "RepCompany" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RepCompany_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RepCompany_name_key" ON "RepCompany"("name");

-- AlterTable
ALTER TABLE "Project" ADD COLUMN "repCompanyId" TEXT;
ALTER TABLE "Job" ADD COLUMN "repCompanyId" TEXT;

-- CreateIndex
CREATE INDEX "Project_repCompanyId_idx" ON "Project"("repCompanyId");
CREATE INDEX "Job_repCompanyId_idx" ON "Job"("repCompanyId");

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_repCompanyId_fkey" FOREIGN KEY ("repCompanyId") REFERENCES "RepCompany"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Job" ADD CONSTRAINT "Job_repCompanyId_fkey" FOREIGN KEY ("repCompanyId") REFERENCES "RepCompany"("id") ON DELETE SET NULL ON UPDATE CASCADE;
