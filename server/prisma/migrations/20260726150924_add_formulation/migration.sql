-- CreateTable
CREATE TABLE "Formulation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "rev" INTEGER NOT NULL DEFAULT 1,
    "product" TEXT NOT NULL DEFAULT '',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "lockReason" TEXT NOT NULL DEFAULT '',
    "capaId" TEXT,
    "components" JSONB NOT NULL DEFAULT '[]',
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Formulation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Formulation_organizationId_idx" ON "Formulation"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Formulation_organizationId_code_rev_key" ON "Formulation"("organizationId", "code", "rev");

-- AddForeignKey
ALTER TABLE "Formulation" ADD CONSTRAINT "Formulation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row-Level Security: hard tenant isolation for Formulation (mirrors the
-- rls_policies migration). FORCE applies the policy even to the table owner;
-- when app.current_tenant is unset the predicate is NULL and no rows match.
ALTER TABLE "Formulation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Formulation" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Formulation";
CREATE POLICY tenant_isolation ON "Formulation"
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));
