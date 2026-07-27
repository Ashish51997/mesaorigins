-- Drop orphan models: zero API usage. Recipe/BOMItem superseded by Formulation;
-- Supplier/PackingRecord had no module; PermissionRule/EmployeeGrant/Delegation
-- were the never-built dynamic-ACL persistence. CASCADE clears their FKs, RLS
-- policies and indexes.
DROP TABLE IF EXISTS "BOMItem" CASCADE;
DROP TABLE IF EXISTS "Recipe" CASCADE;
DROP TABLE IF EXISTS "PackingRecord" CASCADE;
DROP TABLE IF EXISTS "Supplier" CASCADE;
DROP TABLE IF EXISTS "PermissionRule" CASCADE;
DROP TABLE IF EXISTS "EmployeeGrant" CASCADE;
DROP TABLE IF EXISTS "Delegation" CASCADE;
