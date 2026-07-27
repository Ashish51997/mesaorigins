// Throwaway verification: proves tenant isolation holds at runtime.
import { basePrisma, prisma } from '../src/db';
import { tenantContext } from '../src/lib/tenantContext';

function asTenant<T>(organizationId: string, fn: () => Promise<T>): Promise<T> {
  return tenantContext.run({ organizationId, userId: 'x', membershipId: 'x', role: 'Administrator', email: 'x@x' }, async () => await fn());
}

async function main(): Promise<void> {
  // Second tenant with exactly one customer.
  await basePrisma.organization.upsert({ where: { id: 'org-beta' }, update: {}, create: { id: 'org-beta', name: 'Beta Polymers', slug: 'beta' } });
  await asTenant('org-beta', async () => {
    if ((await prisma.customer.count()) === 0) await prisma.customer.create({ data: { name: 'Beta-only Customer' } });
  });

  const demoCount = await asTenant('org-demo', () => prisma.customer.count());
  const betaCount = await asTenant('org-beta', () => prisma.customer.count());
  const betaNames = await asTenant('org-beta', () => prisma.customer.findMany({ select: { name: true } }));

  // RLS fail-closed: raw client, no tenant context/GUC → owner is FORCEd, sees 0.
  const rawNoTenantCount = (await basePrisma.customer.findMany()).length;

  // Cross-tenant id lookup: beta must not read a demo customer even by its id.
  const aDemoCustomer = await asTenant('org-demo', () => prisma.customer.findFirst());
  const crossRead = await asTenant('org-beta', () => prisma.customer.findUnique({ where: { id: aDemoCustomer!.id } }));

  console.log(JSON.stringify({
    demoCount,
    betaCount,
    betaNames: betaNames.map((c) => c.name),
    rawNoTenantCount,
    crossTenantReadIsNull: crossRead === null,
  }, null, 2));

  await basePrisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
