-- One signed copy per work order, held by a unique index.
--
-- Saves pressed at the same moment could each leave a copy. Before the index
-- can be built, every work order keeps its newest copy linked; any older ones
-- stay on the job as files, no longer linked to the work order they came from.
UPDATE "Attachment" AS older
SET "signedFromId" = NULL
WHERE older."signedFromId" IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM "Attachment" AS newer
    WHERE newer."signedFromId" = older."signedFromId"
      AND (
        newer."createdAt" > older."createdAt"
        OR (newer."createdAt" = older."createdAt" AND newer."id" > older."id")
      )
  );

-- CreateIndex
CREATE UNIQUE INDEX "Attachment_signedFromId_key" ON "Attachment"("signedFromId");
