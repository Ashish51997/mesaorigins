import { PrismaClient } from '@prisma/client';

type LegacySplitPlan = {
  salesOrderId: string;
  orderNumber: string;
  planCount: number;
  orderQuantity?: string;
  plannedQuantity?: string;
};

export type MesaOpsPlantBackfillIssue = {
  membershipId: string;
  organizationId: string;
  employeeCode: string;
  protectedRoleId: string;
  reason: string;
};

export type MesaOpsPlantBackfillReadiness = {
  available: boolean;
  eligibleCount: number;
  readyCount: number;
  ambiguous: MesaOpsPlantBackfillIssue[];
};

export function requireMigrationOwnerUrl(env: NodeJS.ProcessEnv): string {
  const value = (env.DIRECT_DATABASE_URL || '').trim();
  if (!value) {
    throw new Error('DIRECT_DATABASE_URL is required for the read-only MesaERP migration preflight.');
  }
  return value;
}

/**
 * Read-only evidence for migration 20260814246000. The migration repeats this
 * classification and fails atomically, so skipping the preflight cannot reuse
 * a colliding or privileged role as MesaOps plant-scope evidence.
 */
export async function inspectMesaOpsPlantBackfill(db: PrismaClient): Promise<MesaOpsPlantBackfillReadiness> {
  const [shape] = await db.$queryRaw<Array<{ available: boolean }>>`
    SELECT (
      to_regclass(current_schema() || '."Membership"') IS NOT NULL
      AND to_regclass(current_schema() || '."Organization"') IS NOT NULL
      AND to_regclass(current_schema() || '."Role"') IS NOT NULL
      AND to_regclass(current_schema() || '."RoleAssignment"') IS NOT NULL
      AND to_regclass(current_schema() || '."RolePermission"') IS NOT NULL
      AND to_regclass(current_schema() || '."OrganizationService"') IS NOT NULL
      AND to_regclass(current_schema() || '."Service"') IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'Role'
          AND column_name = 'erpLegalEntityId'
      )
    ) AS "available"
  `;
  if (!shape?.available) {
    return { available: false, eligibleCount: 0, readyCount: 0, ambiguous: [] };
  }

  const candidates = await db.$queryRaw<Array<{
    membershipId: string;
    organizationId: string;
    employeeCode: string;
    protectedRoleId: string;
    reason: string | null;
  }>>`
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
    )
    SELECT
      classified."membershipId",
      classified."organizationId",
      classified."employeeCode",
      classified."protectedRoleId",
      classified."reason"
    FROM classified
    ORDER BY classified."organizationId", classified."membershipId"
  `;
  const ambiguous = candidates
    .filter((candidate): candidate is typeof candidate & { reason: string } => candidate.reason !== null)
    .map(({ reason, ...candidate }) => ({ ...candidate, reason }));
  return {
    available: true,
    eligibleCount: candidates.length,
    readyCount: candidates.length - ambiguous.length,
    ambiguous,
  };
}

async function main(): Promise<void> {
  const db = new PrismaClient({
    datasources: { db: { url: requireMigrationOwnerUrl(process.env) } },
  });
  try {
    let failed = false;
    const [{ productionPlanExists, plannedQuantityExists }] = await db.$queryRaw<Array<{
      productionPlanExists: boolean;
      plannedQuantityExists: boolean;
    }>>`
      SELECT
        to_regclass(current_schema() || '."ProductionPlan"') IS NOT NULL AS "productionPlanExists",
        EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'ProductionPlan'
          AND column_name = 'plannedQuantity'
        ) AS "plannedQuantityExists"
    `;
    if (!productionPlanExists) {
      console.log('MesaERP migration preflight passed: this is a fresh database with no legacy production plans.');
    } else {
      const splitPlans = plannedQuantityExists
        ? await db.$queryRaw<LegacySplitPlan[]>`
          SELECT
            plan."salesOrderId" AS "salesOrderId",
            orders."soNumber" AS "orderNumber",
            COUNT(*)::int AS "planCount",
            orders."quantity"::text AS "orderQuantity",
            COALESCE(SUM(plan."plannedQuantity"), 0)::text AS "plannedQuantity"
          FROM "ProductionPlan" plan
          JOIN "SalesOrder" orders ON orders."id" = plan."salesOrderId"
          WHERE plan."salesOrderId" IS NOT NULL
          GROUP BY plan."salesOrderId", orders."soNumber", orders."quantity"
          HAVING COUNT(*) > 1
            AND (BOOL_OR(plan."plannedQuantity" IS NULL)
              OR COALESCE(SUM(plan."plannedQuantity"), 0) <> orders."quantity")
          ORDER BY orders."soNumber"
          `
        : await db.$queryRaw<LegacySplitPlan[]>`
          SELECT
            plan."salesOrderId" AS "salesOrderId",
            orders."soNumber" AS "orderNumber",
            COUNT(*)::int AS "planCount"
          FROM "ProductionPlan" plan
          JOIN "SalesOrder" orders ON orders."id" = plan."salesOrderId"
          WHERE plan."salesOrderId" IS NOT NULL
          GROUP BY plan."salesOrderId", orders."soNumber"
          HAVING COUNT(*) > 1
          ORDER BY orders."soNumber"
          `;

      if (splitPlans.length > 0) {
        failed = true;
        console.error('MesaERP migration preflight stopped: legacy split plans need explicit planned-quantity reconciliation.');
        console.error(JSON.stringify(splitPlans, null, 2));
        console.error(plannedQuantityExists
          ? 'Reconcile each plan quantity to the order total, then rerun this preflight before resuming prisma migrate deploy.'
          : 'Record an explicit quantity allocation for each legacy plan before the MesaERP migration; the migration intentionally stops after adding the quantity field so the allocation can be applied without guessing.');
      } else {
        console.log('MesaERP migration preflight passed: no ambiguous legacy multi-plan orders were found.');
      }
    }

    const plantBackfill = await inspectMesaOpsPlantBackfill(db);
    if (!plantBackfill.available) {
      console.log('MesaOps plant-assignment preflight deferred: authorization tables are not installed yet; the additive migration remains fail-fast.');
    } else if (plantBackfill.ambiguous.length > 0) {
      failed = true;
      console.error(`MesaOps plant-assignment preflight stopped: ${plantBackfill.ambiguous.length} of ${plantBackfill.eligibleCount} eligible membership(s) collide with the protected permissionless scope role.`);
      console.error(JSON.stringify(plantBackfill.ambiguous, null, 2));
      console.error('Reconcile the protected role collision without deleting assignment history, then rerun the preflight.');
    } else {
      console.log(`MesaOps plant-assignment preflight passed: ${plantBackfill.readyCount} active entitled legacy membership(s) are deterministic all-plant backfill candidates.`);
    }

    if (failed) process.exitCode = 2;
  } finally {
    await db.$disconnect();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
