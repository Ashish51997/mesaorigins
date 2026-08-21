import { useState } from 'react';
import type { LedgerAccountOption, Vendor } from './model';
import { LiveMrpPlanning } from './LiveMrpPlanning';
import { LiveValuedInventory } from './LiveValuedInventory';
import { LiveTabs } from './liveUi';

export function LiveInventoryPlanning({ entityId, accounts, vendors }: { entityId: string; accounts: LedgerAccountOption[]; vendors: Vendor[] }) {
  const [area, setArea] = useState<'inventory' | 'planning'>('inventory');
  return <div className="space-y-5"><div className="flex justify-end"><LiveTabs value={area} onChange={(value) => setArea(value)} items={[{ id: 'inventory', label: 'Valued inventory' }, { id: 'planning', label: 'MRP & BOM' }]} /></div>{area === 'inventory' ? <LiveValuedInventory entityId={entityId} accounts={accounts} /> : <LiveMrpPlanning entityId={entityId} vendors={vendors} />}</div>;
}
