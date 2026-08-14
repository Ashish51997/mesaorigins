-- Keep compliance rule profiles under the same defense-in-depth tenancy model
-- as every other MesaERP business table. Runtime uses the non-owner app_user,
-- while FORCE RLS also prevents accidental owner sessions from bypassing the
-- policy unless they deliberately use a privileged maintenance role.
ALTER TABLE "ErpComplianceRuleProfile" FORCE ROW LEVEL SECURITY;
