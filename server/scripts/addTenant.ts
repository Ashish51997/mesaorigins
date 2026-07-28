// Provisions a second tenant (Beta Polymers) and demonstrates isolation.
// The org/users/memberships are created directly; the value chain is created
// through the real API (auth → tenant → RLS) as a Beta sales user, so it
// exercises the full stack exactly as a real request would.
import request from 'supertest';
import { basePrisma, prisma } from '../src/db';
import { tenantContext } from '../src/lib/tenantContext';
import { ROLE_DEFAULT_SCREENS, ADMIN_ROLES } from '../src/lib/permissions';
import { buildApp } from '../src/app';

const app = buildApp();
const ORG = 'org-beta';
const RIYA = 'riya@betapolymers.in';

const MEMBERS = [
  { id: 'b-u1', email: 'deepak@betapolymers.in', name: 'Deepak Rao', code: 'BP-001', role: 'Administrator', dept: 'Administration' },
  { id: 'b-u2', email: RIYA, name: 'Riya Shah', code: 'BP-002', role: 'Sales Executive', dept: 'Sales' },
  { id: 'b-u3', email: 'imran@betapolymers.in', name: 'Imran Qureshi', code: 'BP-003', role: 'Operator', dept: 'Production' },
];

async function provision(): Promise<void> {
  await basePrisma.organization.upsert({
    where: { id: ORG }, update: {},
    create: { id: ORG, name: 'Beta Polymers Pvt Ltd', slug: 'beta', plan: 'growth', subscriptionStatus: 'active', status: 'active' },
  });
  for (const m of MEMBERS) {
    await basePrisma.user.upsert({ where: { email: m.email }, update: {}, create: { id: m.id, email: m.email, name: m.name } });
    await basePrisma.membership.upsert({
      where: { organizationId_userId: { organizationId: ORG, userId: m.id } },
      update: {},
      create: { organizationId: ORG, userId: m.id, employeeCode: m.code, department: m.dept, role: m.role },
    });
  }
  // Seed beta's built-in roles + link memberships (GUC-armed; Role is RLS-scoped).
  await basePrisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_tenant', ${ORG}, true)`;
    for (const name of [...new Set(MEMBERS.map((m) => m.role))]) {
      await tx.role.upsert({
        where: { organizationId_name: { organizationId: ORG, name } },
        update: { screens: ROLE_DEFAULT_SCREENS[name] ?? [], isAdmin: ADMIN_ROLES.has(name) },
        create: { organizationId: ORG, name, screens: ROLE_DEFAULT_SCREENS[name] ?? [], isAdmin: ADMIN_ROLES.has(name), isSystem: true },
      });
    }
    const byName = new Map((await tx.role.findMany({ where: { organizationId: ORG } })).map((r) => [r.name, r.id]));
    for (const m of MEMBERS) {
      await tx.membership.update({ where: { organizationId_userId: { organizationId: ORG, userId: m.id } }, data: { roleId: byName.get(m.role) } });
    }
  });
  console.log(`[addTenant] provisioned "${ORG}" with ${MEMBERS.length} members.`);
}

async function seedValueChain(): Promise<void> {
  const existing = await request(app).get('/api/customers').set('x-dev-user', RIYA);
  if (Array.isArray(existing.body) && existing.body.length > 0) {
    console.log('[addTenant] beta already has customers — skipping value chain.');
    return;
  }
  const c1 = await request(app).post('/api/customers').set('x-dev-user', RIYA)
    .send({ name: 'Coastal Pipes & Fittings', gstNumber: '29BETA1111A1Z1', contactPerson: 'S. Menon', phone: '+91 90000 00001', email: 'buy@coastalpipes.in' });
  await request(app).post('/api/customers').set('x-dev-user', RIYA)
    .send({ name: 'Highland Polymers', gstNumber: '29BETA2222B2Z2' });
  const inq = await request(app).post('/api/inquiries').set('x-dev-user', RIYA)
    .send({ customerId: c1.body.id, product: 'HDPE pipe 32mm', quantity: 8000, expectedDeliveryDate: '2026-10-01' });
  await request(app).post(`/api/inquiries/${inq.body.id}/quote`).set('x-dev-user', RIYA).send({ quotationPrice: 58 });
  await request(app).post('/api/orders').set('x-dev-user', RIYA).send({ inquiryId: inq.body.id, priority: 'medium' });
  console.log('[addTenant] seeded beta value chain: 2 customers, 1 inquiry → quote → order.');
}

async function isolationDemo(): Promise<void> {
  const names = (r: { body: unknown }) => (r.body as Array<{ name: string }>).map((c) => c.name);
  const demo = await request(app).get('/api/customers').set('x-dev-user', 'amit.verma@masspolymer.in');
  const beta = await request(app).get('/api/customers').set('x-dev-user', RIYA);
  const demoNames = names(demo);
  const betaNames = names(beta);
  const demoSet = new Set(demoNames);
  const overlap = betaNames.filter((n) => demoSet.has(n));
  console.log('\n===== ISOLATION DEMO — same GET /api/customers, different tenant member =====');
  console.log('org-demo (Amit, Sales Exec) sees :', demoNames);
  console.log('org-beta (Riya, Sales Exec) sees :', betaNames);
  console.log('overlap                          :', overlap.length === 0 ? 'NONE ✓ — fully isolated' : overlap);
}

async function seedMachines(): Promise<void> {
  await tenantContext.run(
    { organizationId: ORG, userId: 'b-u1', membershipId: 'x', role: 'Administrator', email: 'deepak@betapolymers.in' },
    async () => {
      if ((await prisma.machine.count()) > 0) return;
      await prisma.machine.createMany({
        data: [
          { code: 'M01', line: 'HDPE pipe extrusion', family: 'PVC', logbookFormat: 'QR/MFG/013', status: 'running' },
          { code: 'M02', line: 'PVC profile line', family: 'PVC', logbookFormat: 'QR/MFG/013', status: 'attention' },
          { code: 'M03', line: 'Co-extrusion coil', family: 'LDPE', logbookFormat: 'QR/MFG/012', status: 'running' },
        ],
      });
      console.log('[addTenant] seeded 3 machines for beta.');
    },
  );
}

async function main(): Promise<void> {
  await provision();
  await seedMachines();
  await seedValueChain();
  await isolationDemo();
  await basePrisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
