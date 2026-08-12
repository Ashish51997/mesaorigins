ALTER TABLE "LeadSubmission"
ADD COLUMN "clientSubmissionId" TEXT;

CREATE UNIQUE INDEX "LeadSubmission_linkId_clientSubmissionId_key"
ON "LeadSubmission"("linkId", "clientSubmissionId");
