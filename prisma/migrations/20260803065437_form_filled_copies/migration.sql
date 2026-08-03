-- AlterTable
ALTER TABLE "Attachment" ADD COLUMN     "generated" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "sourceTemplateId" TEXT;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_sourceTemplateId_fkey" FOREIGN KEY ("sourceTemplateId") REFERENCES "ClientDocumentTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
