-- Preparing a checkout now keeps what it collected.
--
-- "Prepare checkout" ran the same five steps as the real thing and threw four
-- of them away: only the signatures were written, so the outcome, the release
-- code and the revisit flag were collected from the person standing on site and
-- then lost. The tech who pressed Clock out an hour later was walked through
-- every question again, which is why it felt like a loop — it was one.
--
-- With the answers kept, Clock out can show what is already on the job instead
-- of asking for it a second time. These two columns are what lets that summary
-- say who prepared it and when: the tech about to submit somebody else's
-- answers should be able to see whose they are.

-- AlterTable
ALTER TABLE "Job" ADD COLUMN "checkoutPreparedAt" TIMESTAMP(3);
ALTER TABLE "Job" ADD COLUMN "checkoutPreparedById" TEXT;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_checkoutPreparedById_fkey"
  FOREIGN KEY ("checkoutPreparedById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
