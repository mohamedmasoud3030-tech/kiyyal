const DECIMAL_PATTERN = /^(-?)(\d+)(?:\.(\d+))?$/;

/**
 * Display-only formatter for canonical decimal strings. It intentionally does not
 * parse to a JavaScript number, round, or calculate a financial value.
 */
export function formatCanonicalDecimal(value: string, fractionDigits: number): string {
  const match = DECIMAL_PATTERN.exec(value.trim());
  if (!match) return value;

  const sign = match[1] === '-' ? '-' : '';
  const integer = match[2] ?? '0';
  const fraction = match[3] ?? '';
  const groupedInteger = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const paddedFraction = fraction.padEnd(fractionDigits, '0');

  return fractionDigits > 0 ? `${sign}${groupedInteger}.${paddedFraction}` : `${sign}${groupedInteger}`;
}
