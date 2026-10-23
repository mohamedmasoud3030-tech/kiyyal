/**
 * kg/ton conversion. Contract: docs/FINANCIAL_RULES.md §3, PRD D20, F1.
 *
 * The unit belongs to the LINE, not the material. Switching a line's unit does NOT
 * convert the entered price — the user is quoting anew (D20).
 */
import { Decimal, type EGPPerKg, type EGPPerUnit, egpPerKg, round, SCALE } from './decimal';

export type PriceUnit = 'kg' | 'ton';
export const KG_PER_TON = new Decimal(1000);

export function isPriceUnit(v: string): v is PriceUnit {
  return v === 'kg' || v === 'ton';
}

/** price_per_kg = price_unit === 'ton' ? unit_price / 1000 : unit_price */
export function toPricePerKg(unitPrice: EGPPerUnit, unit: PriceUnit): EGPPerKg {
  const perKg = unit === 'ton' ? unitPrice.dividedBy(KG_PER_TON) : unitPrice;
  return round(perKg, SCALE.perKg) as EGPPerKg;
}

/** Display helper only — never used to store or to re-derive a historical price. */
export function fromPricePerKg(perKg: EGPPerKg, unit: PriceUnit): string {
  const v = unit === 'ton' ? perKg.times(KG_PER_TON) : perKg;
  return round(v, SCALE.unitPrice).toFixed(SCALE.unitPrice);
}

export const zeroPerKg = (): EGPPerKg => egpPerKg('0');
