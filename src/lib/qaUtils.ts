/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { QualityInspection } from '../types';

/**
 * Automates decision evaluation based on mechanical QA criteria.
 */
export function evaluateRollDecision(
  finish: 'pass' | 'fail',
  colour: 'pass' | 'fail',
  tearingTest: 'pass' | 'fail',
  dimensionsAllValid: boolean
): 'pass' | 'fail' {
  if (finish === 'pass' && colour === 'pass' && tearingTest === 'pass' && dimensionsAllValid) {
    return 'pass';
  }
  return 'fail';
}

/**
 * Standardizes packing label QR code metadata pattern.
 */
export function generateQRMetadata(rollNumber: string, weight: number, lotNumber: string): string {
  return `MPERP::${rollNumber}::WT:${weight}::LOT:${lotNumber}`;
}

/**
 * Validates in-line machinery parameters for extrusion line stability.
 * Standard Melt Temp: 160 - 240 C. Cooling water pressure: 2 - 6 bar.
 */
export function validateMachineParameters(meltTempCelsius: number, coolingPressureBar: number): boolean {
  return meltTempCelsius >= 160 && meltTempCelsius <= 240 && coolingPressureBar >= 2 && coolingPressureBar <= 6;
}

/**
 * Ensures scrap and rejected material disposal methods comply with ISO standards.
 * Polymer scraps must be regrinded/sold, never un-logged or landfilled directly if toxic.
 */
export function validateDisposalMethod(method: string, approvalRequired: boolean, approved: boolean): boolean {
  if (approvalRequired && !approved) {
    return false;
  }
  const permitted = ['Regrinded & Recycled', 'Sold to Scrap Contractor', 'Safely Landfilled'];
  return permitted.includes(method);
}
