import { prisma, tenantTx } from '../../db';
import { tenantContext } from '../../lib/tenantContext';
import { audit } from '../../lib/audit';
import { ApiError } from '../../middleware/error';
import { assertMesaOpsPlantAccess, plantCodeFilter, resolveMesaOpsPlantScope } from '../../lib/mesaOpsScope';
import type { ReceiveInput, IssueInput } from './schemas';

function ctx() {
  const c = tenantContext.getStore();
  if (!c) throw new ApiError(401, 'unauthenticated', 'No tenant context.');
  return c;
}
const today = () => new Date().toISOString().slice(0, 10);

export interface StockRow { itemName: string; unit: string; onHand: number }

// On-hand balances derived from the ledger (in − out) — fixes the audit's
// static stock that never moved. Grouped by material + unit within each type.
async function computeStockForWhere(where?: { plantCode: { in: string[] } } | { plantCode: string }) {
  const txns = await prisma.inventoryTransaction.findMany({ where, select: { type: true, direction: true, itemName: true, unit: true, quantity: true } });
  const map = new Map<string, { type: string } & StockRow>();
  for (const t of txns) {
    const key = `${t.type}::${t.itemName}::${t.unit}`;
    const cur = map.get(key) ?? { type: t.type, itemName: t.itemName, unit: t.unit, onHand: 0 };
    cur.onHand += t.direction === 'in' ? t.quantity : -t.quantity;
    map.set(key, cur);
  }
  const rows = [...map.values()];
  const pick = (type: string): StockRow[] =>
    rows.filter((r) => r.type === type).map(({ itemName, unit, onHand }) => ({ itemName, unit, onHand: Math.round(onHand * 100) / 100 }))
      .sort((a, b) => a.itemName.localeCompare(b.itemName));
  return { rawMaterials: pick('raw_material'), finishedGoods: pick('finished_goods') };
}
export async function listStock() {
  const scope = await resolveMesaOpsPlantScope();
  const plants = plantCodeFilter(scope);
  return computeStockForWhere(plants ? { plantCode: plants } : undefined);
}

export async function listTransactions() {
  const scope = await resolveMesaOpsPlantScope();
  const plants = plantCodeFilter(scope);
  return prisma.inventoryTransaction.findMany({ where: plants ? { plantCode: plants } : undefined, orderBy: { createdAt: 'desc' }, take: 50 });
}

/** Receive raw material into store (a ledger IN). */
export async function receive(input: ReceiveInput) {
  const c = ctx();
  const scope = await resolveMesaOpsPlantScope();
  const plantCode = input.plantCode.toUpperCase();
  assertMesaOpsPlantAccess(scope, plantCode);
  return tenantTx(async (tx) => {
    const t = await tx.inventoryTransaction.create({
      data: {
        organizationId: c.organizationId, plantCode, type: 'raw_material', direction: 'in',
        itemCode: input.itemCode || input.itemName, itemName: input.itemName, quantity: input.quantity, unit: input.unit,
        lotNumber: input.lotNumber, reference: input.reference || 'Goods receipt', date: today(), handler: c.email,
      },
    });
    await audit(tx, { action: 'rm.receive', entity: 'InventoryTransaction', entityId: t.id, after: t });
    return t;
  });
}

/** Issue raw material to a machine (a ledger OUT) — machine must exist and there
 *  must be enough stock (fixes the audit's unconnected, unchecked issue). */
export async function issue(input: IssueInput) {
  const c = ctx();
  const scope = await resolveMesaOpsPlantScope();
  const plants = plantCodeFilter(scope);
  const machine = await prisma.machine.findFirst({
    where: { id: input.machineId, ...(plants ? { plantCode: plants } : {}) },
  });
  if (!machine) throw new ApiError(422, 'bad_machine', 'That machine does not exist.');
  const stock = await computeStockForWhere({ plantCode: machine.plantCode });
  const onHand = stock.rawMaterials.find((r) => r.itemName === input.itemName && r.unit === input.unit)?.onHand ?? 0;
  if (onHand < input.quantity) {
    throw new ApiError(409, 'insufficient_stock', `Only ${onHand} ${input.unit} of ${input.itemName} in store — cannot issue ${input.quantity}.`);
  }
  return tenantTx(async (tx) => {
    const t = await tx.inventoryTransaction.create({
      data: {
        organizationId: c.organizationId, plantCode: machine.plantCode, type: 'raw_material', direction: 'out',
        itemCode: input.itemName, itemName: input.itemName, quantity: input.quantity, unit: input.unit,
        reference: `Issued to ${machine.code}`, date: today(), handler: c.email,
      },
    });
    await audit(tx, { action: 'lot.issue', entity: 'InventoryTransaction', entityId: t.id, after: t });
    return t;
  });
}
