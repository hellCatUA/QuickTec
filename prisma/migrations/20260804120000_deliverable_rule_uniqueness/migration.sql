-- CreateIndex
CREATE UNIQUE INDEX "DeliverableRequirement_jobId_category_key" ON "DeliverableRequirement"("jobId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "DeliverableRequirement_projectId_category_key" ON "DeliverableRequirement"("projectId", "category");
