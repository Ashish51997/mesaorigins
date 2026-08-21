/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { InventoryTransaction } from '@mesaops/types';

/**
 * Computes the remaining stock level of a product/resin using a transaction ledger.
 */
export function calculateStockLevel(
  itemCode: string,
  transactions: InventoryTransaction[],
  initialStock: number = 0
): number {
  let stock = initialStock;
  
  const relevantTx = transactions.filter(tx => tx.itemCode === itemCode);
  
  for (const tx of relevantTx) {
    if (tx.direction === 'in') {
      stock += tx.quantity;
    } else if (tx.direction === 'out') {
      stock -= tx.quantity;
    }
  }
  
  return stock;
}

/**
 * Separates transactions into raw materials vs finished goods.
 */
export function filterTransactionsByType(
  transactions: InventoryTransaction[],
  type: 'raw_material' | 'finished_goods'
): InventoryTransaction[] {
  return transactions.filter(tx => tx.type === type);
}
