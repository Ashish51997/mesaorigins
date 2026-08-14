#!/usr/bin/env bash

# Exercise the release migration path with the same privilege boundary used by
# Cloud SQL: postgres only bootstraps the database; the table-owning migration
# identity is an ordinary, non-superuser, non-BYPASSRLS role. Legacy upgrade
# evidence lives in its own database so the normal seed/test database stays
# clean.

set -Eeuo pipefail

database_container="${1:?database container name is required}"
docker_network="${2:?Docker network name is required}"
quality_image="${3:?quality image name is required}"
repository_root="${4:-$(pwd)}"

owner_role="masspolimer"
owner_password="masspolimer"
runtime_role="app_user"
runtime_password="app_user"
main_database="masspolimer"
upgrade_database="mesadesk_upgrade"
migration_cutoff="20260814085000_migration_owner_rls_window"
expected_migration_count=44

setup_roles_file="${repository_root}/server/prisma/setup-roles.sql"
[[ -f "${setup_roles_file}" ]] || {
  echo "Missing role setup file: ${setup_roles_file}" >&2
  exit 1
}

repository_migration_count="$({
  find "${repository_root}/server/prisma/migrations" -mindepth 1 -maxdepth 1 \
    -type d -name '20*' -print
} | wc -l | tr -d '[:space:]')"
[[ "${repository_migration_count}" == "${expected_migration_count}" ]] || {
  echo "Cloud SQL parity fixture expects ${expected_migration_count} migrations; found ${repository_migration_count}. Review and update the upgrade fixture deliberately." >&2
  exit 1
}

psql_as_postgres() {
  docker exec -i \
    -e PGPASSWORD=cloud-build-postgres-bootstrap \
    "${database_container}" \
    psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d postgres "$@"
}

psql_as_owner() {
  local database="$1"
  shift
  docker exec -i \
    -e PGPASSWORD="${owner_password}" \
    "${database_container}" \
    psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U "${owner_role}" -d "${database}" "$@"
}

psql_as_runtime() {
  local database="$1"
  shift
  docker exec -i \
    -e PGPASSWORD="${runtime_password}" \
    "${database_container}" \
    psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U "${runtime_role}" -d "${database}" "$@"
}

create_database_if_missing() {
  local database="$1"
  if [[ "$(psql_as_postgres -qAtc "SELECT 1 FROM pg_database WHERE datname = '${database}'")" != "1" ]]; then
    docker exec -i \
      -e PGPASSWORD=cloud-build-postgres-bootstrap \
      "${database_container}" \
      createdb -h 127.0.0.1 -U postgres -O "${owner_role}" "${database}"
  fi
}

wait_for_postgres_tcp() {
  local ready=0
  local attempt
  for attempt in $(seq 1 60); do
    if psql_as_postgres -qAtc 'SELECT 1' >/dev/null 2>&1; then
      ready=1
      break
    fi
    sleep 1
  done
  [[ "${ready}" == "1" ]] || {
    echo 'PostgreSQL did not accept the parity gate TCP login within 60 seconds.' >&2
    docker logs "${database_container}" >&2 || true
    exit 1
  }
}

run_setup_roles() {
  local database="$1"
  psql_as_owner "${database}" < "${setup_roles_file}"
}

run_quality_image() {
  local database="$1"
  shift
  docker run --rm --network "${docker_network}" \
    -e DATABASE_URL="postgresql://${runtime_role}:${runtime_password}@${database_container}:5432/${database}?schema=public" \
    -e DIRECT_DATABASE_URL="postgresql://${owner_role}:${owner_password}@${database_container}:5432/${database}?schema=public" \
    -e MIGRATION_CUTOFF="${migration_cutoff}" \
    "${quality_image}" "$@"
}

echo '==> Wait for the exact PostgreSQL TCP login used by the parity gate'
wait_for_postgres_tcp

echo '==> Bootstrap ordinary Cloud SQL-parity migration owner'
psql_as_postgres <<'SQL'
DO $bootstrap$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'masspolimer') THEN
    CREATE ROLE masspolimer LOGIN PASSWORD 'masspolimer';
  END IF;
END
$bootstrap$;

ALTER ROLE masspolimer WITH
  LOGIN
  NOSUPERUSER
  CREATEDB
  CREATEROLE
  NOINHERIT
  NOREPLICATION
  NOBYPASSRLS;
SQL

owner_boundary="$(psql_as_postgres -qAtc \
  "SELECT (NOT rolsuper AND NOT rolbypassrls AND NOT rolreplication AND rolcreatedb AND rolcreaterole)::text FROM pg_roles WHERE rolname = '${owner_role}'")"
[[ "${owner_boundary}" == "true" ]] || {
  echo "${owner_role} is not an ordinary non-superuser, non-BYPASSRLS migration owner." >&2
  exit 1
}

create_database_if_missing "${main_database}"
create_database_if_missing "${upgrade_database}"

database_owner_check="$(psql_as_postgres -qAtc \
  "SELECT bool_and(pg_get_userbyid(datdba) = '${owner_role}')::text FROM pg_database WHERE datname IN ('${main_database}', '${upgrade_database}')")"
[[ "${database_owner_check}" == "true" ]] || {
  echo 'The QA databases are not owned by the migration identity.' >&2
  exit 1
}

echo "==> Apply migrations through ${migration_cutoff} on upgrade fixture"
run_setup_roles "${upgrade_database}"
run_quality_image "${upgrade_database}" bash -ceu '
  fixture_root="$(mktemp -d)"
  trap '\''rm -rf "$fixture_root"'\'' EXIT
  mkdir -p "$fixture_root/migrations"
  cp server/prisma/schema.prisma "$fixture_root/schema.prisma"
  cp server/prisma/migrations/migration_lock.toml "$fixture_root/migrations/migration_lock.toml"
  for migration_dir in server/prisma/migrations/20*; do
    migration_name="${migration_dir##*/}"
    if [[ "$migration_name" > "$MIGRATION_CUTOFF" ]]; then
      continue
    fi
    cp -R "$migration_dir" "$fixture_root/migrations/$migration_name"
  done
  npx prisma migrate deploy --schema "$fixture_root/schema.prisma"
'

cutoff_count="$(psql_as_owner "${upgrade_database}" -qAtc \
  "SELECT COUNT(*) FROM \"_prisma_migrations\" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL")"
[[ "${cutoff_count}" == "19" ]] || {
  echo "Expected 19 migrations through ${migration_cutoff}; found ${cutoff_count}." >&2
  exit 1
}

echo '==> Insert two-tenant legacy manufacturing evidence'
psql_as_owner "${upgrade_database}" <<'SQL'
BEGIN;

INSERT INTO "Organization" (
  "id", "name", "slug", "status", "plan", "subscriptionStatus", "settings", "createdAt", "updatedAt"
) VALUES
  ('qa-upgrade-org-a', 'QA Upgrade Alpha', 'qa-upgrade-alpha', 'active', 'starter', 'active', '{}'::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('qa-upgrade-org-b', 'QA Upgrade Beta', 'qa-upgrade-beta', 'active', 'starter', 'active', '{}'::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

INSERT INTO "User" ("id", "email", "name", "createdAt", "updatedAt") VALUES
  ('qa-upgrade-user-a', 'qa-upgrade-alpha@example.invalid', 'QA Alpha Owner', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('qa-upgrade-user-b', 'qa-upgrade-beta@example.invalid', 'QA Beta Owner', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

INSERT INTO "Membership" (
  "id", "organizationId", "userId", "employeeCode", "department", "role", "shift", "line",
  "status", "joinDate", "location", "lastSeen", "version", "createdAt", "updatedAt"
) VALUES
  ('qa-upgrade-member-a', 'qa-upgrade-org-a', 'qa-upgrade-user-a', 'QA-A-OWNER', 'Management', 'Owner', 'D', 'A',
   'active', '2026-01-01', 'Plant A', '', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('qa-upgrade-member-b', 'qa-upgrade-org-b', 'qa-upgrade-user-b', 'QA-B-OWNER', 'Management', 'Owner', 'D', 'B',
   'active', '2026-01-01', 'Plant B', '', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

INSERT INTO "OrganizationService" ("organizationId", "serviceId", "status", "createdAt", "updatedAt") VALUES
  ('qa-upgrade-org-a', 'mesaops', 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('qa-upgrade-org-b', 'mesaops', 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

INSERT INTO "Customer" ("id", "organizationId", "name", "status", "createdAt", "updatedAt") VALUES
  ('qa-upgrade-customer-a', 'qa-upgrade-org-a', 'Alpha Customer', 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('qa-upgrade-customer-b', 'qa-upgrade-org-b', 'Beta Customer', 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

INSERT INTO "Inquiry" (
  "id", "organizationId", "inquiryNumber", "customerId", "product", "quantity", "expectedDeliveryDate",
  "status", "version", "createdAt", "updatedAt"
) VALUES
  ('qa-upgrade-inquiry-a', 'qa-upgrade-org-a', 'QA-INQ-A', 'qa-upgrade-customer-a', 'Alpha Polymer Roll', 120, '2026-09-10',
   'approved', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('qa-upgrade-inquiry-b', 'qa-upgrade-org-b', 'QA-INQ-B', 'qa-upgrade-customer-b', 'Beta Assembly', 48, '2026-09-12',
   'approved', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

INSERT INTO "SalesOrder" (
  "id", "organizationId", "soNumber", "inquiryId", "customerId", "product", "quantity", "deliveryDate",
  "priority", "status", "version", "createdAt", "updatedAt"
) VALUES
  ('qa-upgrade-order-a', 'qa-upgrade-org-a', 'QA-SO-A', 'qa-upgrade-inquiry-a', 'qa-upgrade-customer-a',
   'Alpha Polymer Roll', 120, '2026-09-10', 'high', 'planned', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('qa-upgrade-order-b', 'qa-upgrade-org-b', 'QA-SO-B', 'qa-upgrade-inquiry-b', 'qa-upgrade-customer-b',
   'Beta Assembly', 48, '2026-09-12', 'medium', 'dispatched', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

INSERT INTO "Machine" ("id", "organizationId", "code", "line", "family", "status") VALUES
  ('qa-upgrade-machine-a', 'qa-upgrade-org-a', 'QA-MACHINE-A', 'Line A', 'PVC', 'running'),
  ('qa-upgrade-machine-b', 'qa-upgrade-org-b', 'QA-MACHINE-B', 'Line B', 'ASSEMBLY', 'running');

INSERT INTO "ProductionPlan" (
  "id", "organizationId", "salesOrderId", "machineId", "shift", "operatorName",
  "scheduledStartDate", "scheduledEndDate", "status", "version", "createdAt", "updatedAt"
) VALUES
  ('qa-upgrade-plan-a', 'qa-upgrade-org-a', 'qa-upgrade-order-a', 'qa-upgrade-machine-a', 'D', 'Alpha Operator',
   '2026-09-01', '2026-09-02', 'scheduled', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('qa-upgrade-plan-b', 'qa-upgrade-org-b', 'qa-upgrade-order-b', 'qa-upgrade-machine-b', 'N', 'Beta Operator',
   '2026-09-03', '2026-09-04', 'completed', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

INSERT INTO "DispatchRecord" (
  "id", "organizationId", "invoiceNumber", "salesOrderId", "vehicleNumber", "transporter",
  "dispatchDate", "deliveryAddress", "status", "version", "createdAt", "updatedAt"
) VALUES
  ('qa-upgrade-dispatch-a', 'qa-upgrade-org-a', 'QA-INV-A', 'qa-upgrade-order-a', 'QA01AA0001', 'Alpha Logistics',
   '2026-09-03', 'Alpha Delivery Dock', 'ready', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('qa-upgrade-dispatch-b', 'qa-upgrade-org-b', 'QA-INV-B', 'qa-upgrade-order-b', 'QA02BB0002', 'Beta Logistics',
   '2026-09-05', 'Beta Delivery Dock', 'shipped', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

COMMIT;
SQL

echo '==> Upgrade the legacy fixture through every migration'
run_quality_image "${upgrade_database}" npm run release:migrate

final_count="$(psql_as_owner "${upgrade_database}" -qAtc \
  "SELECT COUNT(*) FROM \"_prisma_migrations\" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL")"
[[ "${final_count}" == "${expected_migration_count}" ]] || {
  echo "Expected ${expected_migration_count} completed migrations; found ${final_count}." >&2
  exit 1
}

echo '==> Assert both tenants and all legacy evidence were backfilled'
psql_as_owner "${upgrade_database}" <<'SQL'
DO $assert_backfill$
DECLARE
  organization_id text;
  order_id text;
  member_id text;
BEGIN
  FOREACH organization_id IN ARRAY ARRAY['qa-upgrade-org-a', 'qa-upgrade-org-b'] LOOP
    IF (SELECT COUNT(*) FROM "LegalEntity" WHERE "organizationId" = organization_id AND "code" = 'PRIMARY') <> 1 THEN
      RAISE EXCEPTION 'legal-entity backfill missing or duplicated for %', organization_id;
    END IF;
  END LOOP;

  FOREACH order_id IN ARRAY ARRAY['qa-upgrade-order-a', 'qa-upgrade-order-b'] LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM "OperationalOrder" operational_order
      JOIN "SalesOrder" sales_order ON sales_order."id" = operational_order."legacySalesOrderId"
      WHERE operational_order."id" = order_id
        AND sales_order."id" = order_id
        AND operational_order."organizationId" = sales_order."organizationId"
        AND operational_order."quantity" = sales_order."quantity"
        AND operational_order."plantCode" = 'PRIMARY'
    ) THEN
      RAISE EXCEPTION 'operational-order backfill missing or invalid for %', order_id;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM "ProductionPlan" plan
    JOIN "OperationalOrder" operational_order ON operational_order."id" = plan."operationalOrderId"
    JOIN "Machine" machine ON machine."id" = plan."machineId"
    WHERE plan."id" IN ('qa-upgrade-plan-a', 'qa-upgrade-plan-b')
      AND (
        plan."operationalOrderId" IS DISTINCT FROM plan."salesOrderId"
        OR plan."plannedQuantity" IS NULL
        OR operational_order."plantCode" <> 'PRIMARY'
        OR machine."plantCode" <> operational_order."plantCode"
      )
  ) OR (SELECT COUNT(*) FROM "ProductionPlan" WHERE "id" IN ('qa-upgrade-plan-a', 'qa-upgrade-plan-b')) <> 2 THEN
    RAISE EXCEPTION 'production-plan linkage backfill is incomplete';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "DispatchRecord" dispatch
    JOIN "OperationalOrder" operational_order ON operational_order."id" = dispatch."operationalOrderId"
    WHERE dispatch."id" IN ('qa-upgrade-dispatch-a', 'qa-upgrade-dispatch-b')
      AND (
        dispatch."operationalOrderId" IS DISTINCT FROM dispatch."salesOrderId"
        OR dispatch."quantity" <> operational_order."quantity"
        OR dispatch."uom" <> operational_order."uom"
      )
  ) OR (SELECT COUNT(*) FROM "DispatchRecord" WHERE "id" IN ('qa-upgrade-dispatch-a', 'qa-upgrade-dispatch-b')) <> 2 THEN
    RAISE EXCEPTION 'dispatch linkage backfill is incomplete';
  END IF;

  FOREACH member_id IN ARRAY ARRAY['qa-upgrade-member-a', 'qa-upgrade-member-b'] LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM "RoleAssignment" assignment
      JOIN "Role" role ON role."id" = assignment."roleId"
      WHERE assignment."membershipId" = member_id
        AND assignment."serviceId" = 'mesaops'
        AND assignment."status" = 'active'
        AND assignment."plantCode" IS NULL
        AND role."name" = 'MesaOps Plant Access'
        AND role."isSystem"
        AND NOT role."isAdmin"
        AND role."screens" = '[]'::jsonb
    ) THEN
      RAISE EXCEPTION 'explicit MesaOps plant-scope backfill missing for %', member_id;
    END IF;
  END LOOP;
END
$assert_backfill$;
SQL

echo '==> Assert every FORCE-RLS table has tenant and exact-owner policies'
psql_as_owner "${upgrade_database}" <<'SQL'
DO $assert_rls$
DECLARE
  migration_owner_oid oid := (SELECT oid FROM pg_roles WHERE rolname = 'masspolimer');
  tenant_table record;
  owner_policy record;
  normalized_owner_qual text;
  normalized_owner_check text;
  expected_owner_expression constant text := 'CURRENT_USER=''masspolimer''::nameANDSESSION_USER=''masspolimer''::name';
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_class relation
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relkind IN ('r', 'p')
      AND relation.relowner <> migration_owner_oid
  ) THEN
    RAISE EXCEPTION 'a public application table is not owned by masspolimer';
  END IF;

  FOR tenant_table IN
    SELECT
      relation.oid AS relation_oid,
      namespace.nspname AS schema_name,
      relation.relname AS table_name,
      relation.relowner AS owner_oid
    FROM pg_class relation
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relkind IN ('r', 'p')
      AND relation.relrowsecurity
      AND relation.relforcerowsecurity
  LOOP
    IF tenant_table.owner_oid <> migration_owner_oid THEN
      RAISE EXCEPTION 'FORCE-RLS table %.% is not owned by masspolimer', tenant_table.schema_name, tenant_table.table_name;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_policy policy
      WHERE policy.polrelid = tenant_table.relation_oid
        AND policy.polname = 'tenant_isolation'
        AND policy.polpermissive
        AND policy.polcmd = '*'
    ) THEN
      RAISE EXCEPTION 'tenant_isolation policy missing from %.%', tenant_table.schema_name, tenant_table.table_name;
    END IF;

    SELECT
      policy.polpermissive,
      policy.polcmd,
      policy.polroles,
      pg_get_expr(policy.polqual, policy.polrelid) AS policy_qual,
      pg_get_expr(policy.polwithcheck, policy.polrelid) AS policy_check
    INTO owner_policy
    FROM pg_policy policy
    WHERE policy.polrelid = tenant_table.relation_oid
      AND policy.polname = 'migration_owner_all_tenants';

    IF NOT FOUND THEN
      RAISE EXCEPTION 'migration_owner_all_tenants policy missing from %.%', tenant_table.schema_name, tenant_table.table_name;
    END IF;

    normalized_owner_qual := regexp_replace(owner_policy.policy_qual, '[[:space:]()]', '', 'g');
    normalized_owner_check := regexp_replace(owner_policy.policy_check, '[[:space:]()]', '', 'g');
    IF NOT owner_policy.polpermissive
      OR owner_policy.polcmd <> '*'
      OR owner_policy.polroles <> ARRAY[migration_owner_oid]::oid[]
      OR normalized_owner_qual <> expected_owner_expression
      OR normalized_owner_check <> expected_owner_expression
    THEN
      RAISE EXCEPTION 'migration-owner policy on %.% is broader than the exact masspolimer session/current-user boundary (roles %, using %, check %)',
        tenant_table.schema_name,
        tenant_table.table_name,
        owner_policy.polroles,
        owner_policy.policy_qual,
        owner_policy.policy_check;
    END IF;
  END LOOP;
END
$assert_rls$;
SQL

echo '==> Assert app_user is fail-closed and tenant-isolated'
psql_as_runtime "${upgrade_database}" <<'SQL'
DO $assert_runtime_reads$
BEGIN
  IF (SELECT COUNT(*) FROM "Customer") <> 0 THEN
    RAISE EXCEPTION 'app_user can read tenant data without a tenant setting';
  END IF;

  PERFORM set_config('app.current_tenant', 'qa-upgrade-org-a', false);
  IF (SELECT COUNT(*) FROM "Customer") <> 1
    OR NOT EXISTS (SELECT 1 FROM "Customer" WHERE "id" = 'qa-upgrade-customer-a')
    OR EXISTS (SELECT 1 FROM "Customer" WHERE "id" = 'qa-upgrade-customer-b')
  THEN
    RAISE EXCEPTION 'app_user tenant A reads are not isolated';
  END IF;
END
$assert_runtime_reads$;
SQL

cross_tenant_log="$(mktemp)"
if psql_as_runtime "${upgrade_database}" >"${cross_tenant_log}" 2>&1 <<'SQL'
BEGIN;
SET LOCAL app.current_tenant = 'qa-upgrade-org-a';
INSERT INTO "Customer" ("id", "organizationId", "name", "status", "createdAt", "updatedAt")
VALUES ('qa-illegal-cross-tenant-customer', 'qa-upgrade-org-b', 'Must be rejected', 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
ROLLBACK;
SQL
then
  rm -f "${cross_tenant_log}"
  echo 'app_user unexpectedly inserted a cross-tenant row.' >&2
  exit 1
fi
if ! grep -Eqi 'row-level security|violates.*policy' "${cross_tenant_log}"; then
  cat "${cross_tenant_log}" >&2
  rm -f "${cross_tenant_log}"
  echo 'Cross-tenant insert failed for an unexpected reason.' >&2
  exit 1
fi
rm -f "${cross_tenant_log}"

main_table_count="$(psql_as_owner "${main_database}" -qAtc \
  "SELECT COUNT(*) FROM pg_class relation JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace WHERE namespace.nspname = 'public' AND relation.relkind IN ('r', 'p')")"
[[ "${main_table_count}" == "0" ]] || {
  echo "The legacy upgrade fixture polluted the clean ${main_database} seed/test database." >&2
  exit 1
}

echo 'Cloud SQL-parity migration and tenant-isolation gate passed.'
