-- AlterTable
ALTER TABLE "DispatchContact" ADD COLUMN     "clientId" TEXT;

-- CreateIndex
CREATE INDEX "DispatchContact_clientId_idx" ON "DispatchContact"("clientId");

-- AddForeignKey
ALTER TABLE "DispatchContact" ADD CONSTRAINT "DispatchContact_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
