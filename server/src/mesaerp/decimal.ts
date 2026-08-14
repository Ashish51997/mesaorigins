export const DECIMAL_SCALE = 6;

const DECIMAL_PATTERN = /^\d{1,18}(?:\.\d{1,6})?$/;

export function isDecimalString(value: unknown): value is string {
  return typeof value === 'string' && DECIMAL_PATTERN.test(value);
}

/**
 * Convert a validated, non-negative decimal string to a fixed-scale bigint.
 * MesaERP never uses IEEE-754 numbers for quantities or money.
 */
export function decimalToScaled(value: string): bigint {
  if (!isDecimalString(value)) throw new TypeError(`Invalid decimal string: ${value}`);
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * (10n ** BigInt(DECIMAL_SCALE))
    + BigInt((fraction + '0'.repeat(DECIMAL_SCALE)).slice(0, DECIMAL_SCALE));
}

export function scaledToDecimal(value: bigint): string {
  const divisor = 10n ** BigInt(DECIMAL_SCALE);
  const whole = value / divisor;
  const fraction = (value % divisor).toString().padStart(DECIMAL_SCALE, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

export function decimalIsPositive(value: string): boolean {
  return decimalToScaled(value) > 0n;
}

export function decimalSum(values: string[]): bigint {
  return values.reduce((sum, value) => sum + decimalToScaled(value), 0n);
}
