-- CreateEnum
CREATE TYPE "FormBoxSource" AS ENUM ('FIELDS', 'DRAWN');

-- CreateEnum
CREATE TYPE "FormPlacementKind" AS ENUM ('TEXT', 'CHECK', 'SIGNATURE');

-- AlterTable
ALTER TABLE "ClientDocumentTemplate" ADD COLUMN     "boxSource" "FormBoxSource",
ADD COLUMN     "pageCount" INTEGER,
ADD COLUMN     "pageHeight" DOUBLE PRECISION,
ADD COLUMN     "pageWidth" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "FormPlacement" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "fieldName" TEXT,
    "page" INTEGER NOT NULL DEFAULT 0,
    "x" DOUBLE PRECISION NOT NULL,
    "y" DOUBLE PRECISION NOT NULL,
    "width" DOUBLE PRECISION NOT NULL,
    "height" DOUBLE PRECISION NOT NULL,
    "kind" "FormPlacementKind" NOT NULL DEFAULT 'TEXT',
    "source" TEXT,
    "staticText" TEXT,
    "rowIndex" INTEGER,
    "fontSize" DOUBLE PRECISION,
    "sampleText" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "FormPlacement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FormPlacement_templateId_page_idx" ON "FormPlacement"("templateId", "page");

-- AddForeignKey
ALTER TABLE "FormPlacement" ADD CONSTRAINT "FormPlacement_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ClientDocumentTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
