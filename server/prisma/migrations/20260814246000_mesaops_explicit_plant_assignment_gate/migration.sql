-- Production MesaOps plant access now requires an explicit RoleAssignment.
-- Preserve only the users who were active and entitled at migration time by
-- recording their former implicit access as an explicit all-plant assignment.
--
-- Legacy production data does not necessarily contain tenant Role rows, so the
-- backfill deliberately does not infer authorization from Membership.role. A
-- dedicated permissionless system role is created per organization and used
-- only as the relational anchor for MesaOps plant scope. It grants no screens,
-- admin bypass, MesaERP permission, or company scope.
--
-- Existing assignment history is never broadened or replaced: a revoked,
-- expired, plant-specific, or warehouse-specific row is an intentional scope
-- decision and therefore excludes that membership from this backfill.

BEGIN;

-- Keep the zero-history decision and its insert atomic with membership and
-- assignment writes made by an older application revision during deployment.
LOCK TABLE "Membership", "RoleAssignment", "Role", "Organization", "OrganizationService", "Service"
  IN SHARE ROW EXCLUSIVE MODE;

-- The protected role name/id must not already be occupied by a role with
-- authority. Fail before writing anything rather than reusing or mutating it.
DO $$
DECLARE
  ambiguous_count INTEGER;
  ambiguous_sample TEXT;
BEGIN
  WITH eligible AS (
    SELECT member.*
    FROM "Membership" member
    JOIN "Organization" organization
      ON organization."id" = member."organizationId"
     AND organization."status" <> 'suspended'
    JOIN "OrganizationService" entitlement
      ON entitlement."organizationId" = member."organizationId"
     AND entitlement."serviceId" = 'mesaops'
     AND entitlement."status" = 'active'
    JOIN "Service" service
      ON service."id" = entitlement."serviceId"
     AND service."status" = 'active'
    WHERE member."status" = 'active'
      AND NOT EXISTS (
        SELECT 1
        FROM "RoleAssignment" history
        WHERE history."membershipId" = member."id"
          AND history."serviceId" = 'mesaops'
      )
  ), classified AS (
    SELECT
      eligible."id" AS "membershipId",
      eligible."organizationId",
      eligible."employeeCode",
      'mesaops-plant-access-' || md5(eligible."organizationId") AS "protectedRoleId",
      CASE
        WHEN EXISTS (
          SELECT 1 FROM "RoleAssignment" assignment_by_id
          WHERE assignment_by_id."id" = 'mesaops-all-plant-backfill-' || md5(eligible."id")
        ) THEN 'protected_assignment_id_collision'
        WHEN role_by_id."id" IS NOT NULL
          AND (role_by_id."organizationId" <> eligible."organizationId"
            OR role_by_id."name" <> 'MesaOps Plant Access')
          THEN 'protected_role_id_collision'
        WHEN role_by_name."id" IS NOT NULL
          AND role_by_name."id" <> 'mesaops-plant-access-' || md5(eligible."organizationId")
          THEN 'protected_role_name_collision'
        WHEN protected_role."id" IS NOT NULL
          AND (
            protected_role."erpLegalEntityId" IS NOT NULL
            OR protected_role."isAdmin"
            OR NOT protected_role."isSystem"
            OR protected_role."screens" <> '[]'::jsonb
            OR EXISTS (
              SELECT 1 FROM "RolePermission" grant_row
              WHERE grant_row."roleId" = protected_role."id"
            )
            OR EXISTS (
              SELECT 1 FROM "RoleAssignment" other_assignment
              WHERE other_assignment."roleId" = protected_role."id"
                AND other_assignment."serviceId" <> 'mesaops'
            )
          )
          THEN 'protected_role_not_permissionless'
        ELSE NULL
      END AS "reason"
    FROM eligible
    LEFT JOIN "Role" role_by_id
      ON role_by_id."id" = 'mesaops-plant-access-' || md5(eligible."organizationId")
    LEFT JOIN "Role" role_by_name
      ON role_by_name."organizationId" = eligible."organizationId"
     AND role_by_name."name" = 'MesaOps Plant Access'
    LEFT JOIN "Role" protected_role
      ON protected_role."id" = 'mesaops-plant-access-' || md5(eligible."organizationId")
     AND protected_role."organizationId" = eligible."organizationId"
     AND protected_role."name" = 'MesaOps Plant Access'
  ), ambiguous AS (
    SELECT * FROM classified WHERE "reason" IS NOT NULL
  )
  SELECT COALESCE(MAX(sample."totalCount"), 0), STRING_AGG(sample."summary", ', ' ORDER BY sample."summary")
  INTO ambiguous_count, ambiguous_sample
  FROM (
    SELECT
      COUNT(*) OVER ()::INTEGER AS "totalCount",
      FORMAT(
        '%s/%s(roleId=%s, reason=%s)',
        ambiguous."organizationId",
        ambiguous."employeeCode",
        ambiguous."protectedRoleId",
        ambiguous."reason"
      ) AS "summary"
    FROM ambiguous
    ORDER BY ambiguous."organizationId", ambiguous."membershipId"
    LIMIT 10
  ) sample;

  IF ambiguous_count > 0 THEN
    RAISE EXCEPTION
      'MesaOps plant-assignment backfill found % protected-role collision(s). Reconcile without deleting assignment history. Sample: %',
      ambiguous_count,
      COALESCE(ambiguous_sample, 'unavailable');
  END IF;
END $$;

-- Runtime role revalidation probes assignments by role and service. Keep that
-- fail-closed check indexed as authorization history grows.
CREATE INDEX IF NOT EXISTS "RoleAssignment_roleId_serviceId_idx"
  ON "RoleAssignment"("roleId", "serviceId");

INSERT INTO "Role" (
  "id", "organizationId", "erpLegalEntityId", "name", "screens",
  "isAdmin", "isSystem", "version", "createdAt", "updatedAt"
)
SELECT DISTINCT
  'mesaops-plant-access-' || md5(member."organizationId"),
  member."organizationId",
  NULL,
  'MesaOps Plant Access',
  '[]'::jsonb,
  false,
  true,
  0,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Membership" member
JOIN "Organization" organization
  ON organization."id" = member."organizationId"
 AND organization."status" <> 'suspended'
JOIN "OrganizationService" entitlement
  ON entitlement."organizationId" = member."organizationId"
 AND entitlement."serviceId" = 'mesaops'
 AND entitlement."status" = 'active'
JOIN "Service" service
  ON service."id" = entitlement."serviceId"
 AND service."status" = 'active'
WHERE member."status" = 'active'
  AND NOT EXISTS (
    SELECT 1
    FROM "RoleAssignment" history
    WHERE history."membershipId" = member."id"
      AND history."serviceId" = 'mesaops'
  )
ON CONFLICT ("organizationId", "name") DO NOTHING;

INSERT INTO "RoleAssignment" (
  "id", "organizationId", "membershipId", "roleId", "serviceId",
  "legalEntityId", "plantCode", "warehouseId", "validFrom", "validTo",
  "status", "rowVersion", "revokedAt", "revokedBy", "revocationReason",
  "createdAt", "updatedAt"
)
SELECT
  'mesaops-all-plant-backfill-' || md5(member."id"),
  member."organizationId",
  member."id",
  protected_role."id",
  'mesaops',
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  'active',
  0,
  NULL,
  '',
  '',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Membership" member
JOIN "Organization" organization
  ON organization."id" = member."organizationId"
 AND organization."status" <> 'suspended'
JOIN "OrganizationService" entitlement
  ON entitlement."organizationId" = member."organizationId"
 AND entitlement."serviceId" = 'mesaops'
 AND entitlement."status" = 'active'
JOIN "Service" service
  ON service."id" = entitlement."serviceId"
 AND service."status" = 'active'
JOIN "Role" protected_role
  ON protected_role."id" = 'mesaops-plant-access-' || md5(member."organizationId")
 AND protected_role."organizationId" = member."organizationId"
 AND protected_role."name" = 'MesaOps Plant Access'
 AND protected_role."erpLegalEntityId" IS NULL
 AND protected_role."isAdmin" = false
 AND protected_role."isSystem" = true
 AND protected_role."screens" = '[]'::jsonb
WHERE member."status" = 'active'
  AND NOT EXISTS (
    SELECT 1
    FROM "RoleAssignment" history
    WHERE history."membershipId" = member."id"
      AND history."serviceId" = 'mesaops'
  )
  AND NOT EXISTS (
    SELECT 1 FROM "RolePermission" grant_row
    WHERE grant_row."roleId" = protected_role."id"
  )
  AND NOT EXISTS (
    SELECT 1 FROM "RoleAssignment" other_assignment
    WHERE other_assignment."roleId" = protected_role."id"
      AND other_assignment."serviceId" <> 'mesaops'
  )
ON CONFLICT DO NOTHING;

-- Prove the migration achieved its contract before releasing the locks. This
-- catches an unexpected trigger, collision, or partial insert while keeping
-- the whole migration rollback-safe.
DO $$
DECLARE
  remaining_count INTEGER;
  remaining_sample TEXT;
BEGIN
  WITH remaining AS (
    SELECT member."id", member."organizationId", member."employeeCode"
    FROM "Membership" member
    JOIN "Organization" organization
      ON organization."id" = member."organizationId"
     AND organization."status" <> 'suspended'
    JOIN "OrganizationService" entitlement
      ON entitlement."organizationId" = member."organizationId"
     AND entitlement."serviceId" = 'mesaops'
     AND entitlement."status" = 'active'
    JOIN "Service" service
      ON service."id" = entitlement."serviceId"
     AND service."status" = 'active'
    WHERE member."status" = 'active'
      AND NOT EXISTS (
        SELECT 1
        FROM "RoleAssignment" history
        WHERE history."membershipId" = member."id"
          AND history."serviceId" = 'mesaops'
      )
  )
  SELECT COUNT(*)::INTEGER,
         (
           SELECT STRING_AGG(sample."summary", ', ' ORDER BY sample."summary")
           FROM (
             SELECT FORMAT('%s/%s', remaining_sample_row."organizationId", remaining_sample_row."employeeCode") AS "summary"
             FROM remaining remaining_sample_row
             ORDER BY remaining_sample_row."organizationId", remaining_sample_row."id"
             LIMIT 10
           ) sample
         )
  INTO remaining_count, remaining_sample
  FROM remaining;

  IF remaining_count > 0 THEN
    RAISE EXCEPTION
      'MesaOps plant-assignment backfill postcondition failed for % active entitled membership(s). Sample: %',
      remaining_count,
      COALESCE(remaining_sample, 'unavailable');
  END IF;
END $$;

COMMIT;
