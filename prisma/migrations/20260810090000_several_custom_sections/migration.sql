-- One row per section per owner was right for the nine fixed categories and
-- wrong for Custom Field: a job often needs several, each named for what it
-- holds. Partial indexes say exactly that, which a plain unique constraint
-- cannot.
DROP INDEX IF EXISTS "DeliverableRequirement_jobId_category_key";
DROP INDEX IF EXISTS "DeliverableRequirement_projectId_category_key";

CREATE UNIQUE INDEX "DeliverableRequirement_jobId_category_key"
  ON "DeliverableRequirement"("jobId", "category")
  WHERE "category" <> 'CUSTOM';

CREATE UNIQUE INDEX "DeliverableRequirement_projectId_category_key"
  ON "DeliverableRequirement"("projectId", "category")
  WHERE "category" <> 'CUSTOM';

-- And no two custom sections on one owner sharing a name, which would be two
-- rows nobody could tell apart.
CREATE UNIQUE INDEX "DeliverableRequirement_jobId_custom_key"
  ON "DeliverableRequirement"("jobId", "customLabel")
  WHERE "category" = 'CUSTOM';

CREATE UNIQUE INDEX "DeliverableRequirement_projectId_custom_key"
  ON "DeliverableRequirement"("projectId", "customLabel")
  WHERE "category" = 'CUSTOM';
