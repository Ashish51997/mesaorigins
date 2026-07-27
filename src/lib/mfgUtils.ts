/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { BOMRecipe } from '../types';

/**
 * Calculates the Overall Equipment Effectiveness (OEE) percentage.
 */
export function calculateOEE(availability: number, performance: number, quality: number): number {
  if (availability < 0 || performance < 0 || quality < 0) return 0;
  return (availability / 100) * (performance / 100) * (quality / 100) * 100;
}

/**
 * Calculates the weighted average cost per Kg of a polymer recipe BOM in USD.
 */
export function calculateRecipeCost(recipe: BOMRecipe): number {
  if (!recipe || !recipe.items || recipe.items.length === 0) return 0;
  
  const totalBOMPortions = recipe.items.reduce((sum, item) => sum + item.portion, 0);
  if (totalBOMPortions === 0) return 0;

  const weightedSum = recipe.items.reduce((sum, item) => {
    return sum + (item.unitCost * (item.portion / 100));
  }, 0);

  return weightedSum / (totalBOMPortions / 100);
}

/**
 * Calculates compounding yield percentage from consumed raw materials and output weights.
 */
export function calculateCompoundingYield(totalConsumedKg: number, outputKg: number, scrapKg: number): number {
  if (totalConsumedKg <= 0) return 0;
  const directYield = (outputKg / totalConsumedKg) * 100;
  return Math.min(100, Math.max(0, directYield));
}

/**
 * Calculates sum of machine downtime hours logged in breakdown logs.
 */
export function calculateTotalDowntime(maintenanceTasks: { type: string; downtimeHours?: number }[]): number {
  return maintenanceTasks
    .filter(t => t.type === 'Breakdown')
    .reduce((sum, t) => sum + (t.downtimeHours || 0), 0);
}
