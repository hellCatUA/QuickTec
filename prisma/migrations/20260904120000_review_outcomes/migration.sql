-- Saying something other than yes, and keeping a record of having looked.
--
-- The read-through before a job was signed off had one button on the end of it,
-- so a reviewer who found something wrong had nowhere to put that: the only
-- move available was to approve anyway or to walk away and leave the job in the
-- queue. Two states give the two real answers — send it back to be fixed, or
-- refuse it outright — and both carry the reason with them.
--
-- CHANGES_REQUESTED is deliberately not IN_PROGRESS. The day is over and
-- everybody is clocked out, so nothing would move a job parked there forward
-- again: PENDING_REVIEW is reached by the last person clocking out, and there
-- is no clock-out left to come.

-- AlterEnum
-- Placed where they belong in the sequence rather than appended, so the type
-- reads in the order a job actually moves through it.
ALTER TYPE "JobLifecycle" ADD VALUE 'CHANGES_REQUESTED' BEFORE 'APPROVED';
ALTER TYPE "JobLifecycle" ADD VALUE 'REJECTED' AFTER 'APPROVED';

-- AlterTable
-- The reason for the round in progress. History lives in AuditEvent; this is
-- what the crew are shown at the top of the job, and it is cleared when they
-- resubmit so it never describes a round that is already over.
ALTER TABLE "Job"
  ADD COLUMN "reviewNote"     TEXT,
  ADD COLUMN "reviewNoteById" TEXT,
  ADD COLUMN "reviewNoteAt"   TIMESTAMP(3);

-- CreateTable
CREATE TABLE "JobReviewCheck" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "step" TEXT NOT NULL,
    "checkedById" TEXT,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "flagsSeen" TEXT NOT NULL,
    "note" TEXT,

    CONSTRAINT "JobReviewCheck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "JobReviewCheck_jobId_step_key" ON "JobReviewCheck"("jobId", "step");

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_reviewNoteById_fkey" FOREIGN KEY ("reviewNoteById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobReviewCheck" ADD CONSTRAINT "JobReviewCheck_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobReviewCheck" ADD CONSTRAINT "JobReviewCheck_checkedById_fkey" FOREIGN KEY ("checkedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
