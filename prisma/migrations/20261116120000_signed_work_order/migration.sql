-- The paying company's work order, signed as the job's sign-off: the copy
-- points at the work order it was made from, and keeps where the sign-off
-- went on it so signing it again starts from there.

-- AlterTable
ALTER TABLE "Attachment" ADD COLUMN     "overlay" JSONB,
ADD COLUMN     "signedFromId" TEXT;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_signedFromId_fkey" FOREIGN KEY ("signedFromId") REFERENCES "Attachment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
