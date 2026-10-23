/**
 * Line arithmetic: deduction, net weight, line total.
 * Contract: docs/FINANCIAL_RULES.md §2 and §3. Golden examples G-1…G-4.
 */
import {
  Decimal, type EGP, type EGPPerKg, type EGPPerUnit, type Kg, type Percent,
  gt, gte, roundMoney, roundWeight, SCALE, round,
} from './decimal';
import { toPricePerKg, type PriceUnit } from './units';

export type DeductionType = 'none' | 'percent' | 'kg';

export interface LineInput {
  readonly grossKg: Kg;
  readonly deductionType: DeductionType;
  readonly deductionValue: Percent | Kg | Decimal;
  readonly unitPrice: EGPPerUnit;
  readonly priceUnit: PriceUnit;
}

export interface LineResult {
  readonly netKg: Kg;
  readonly deductionKg: Kg;
  readonly pricePerKg: EGPPerKg;
  readonly lineTotal: EGP;
}

export class DomainError extends Error {
  constructor(readonly code: string, message: string, readonly details?: Record<string, string>) {
    super(message);
    this.name = 'DomainError';
  }
}

export function computeDeductionKg(grossKg: Kg, type: DeductionType, value: Decimal): Kg {
  if (type === 'none') return roundWeight(new Decimal(0));
  if (type === 'percent') {
    if (gte(value, new Decimal(100))) {
      throw new DomainError('invalid_deduction', 'الخصم أكبر من أو يساوي الوزن القائم');
    }
    return roundWeight(grossKg.times(value).dividedBy(100));
  }
  return roundWeight(value);
}

/** Full line computation. Server-side only; a client-supplied total is always ignored. */
export function computeLine(input: LineInput): LineResult {
  const { grossKg, deductionType, deductionValue, unitPrice, priceUnit } = input;

  if (!gt(grossKg, new Decimal(0))) {
    throw new DomainError('invalid_weight', 'وزن غير صالح');
  }

  const deductionKg = computeDeductionKg(grossKg, deductionType, deductionValue as Decimal);
  const netRaw = grossKg.minus(deductionKg);
  if (!gt(netRaw, new Decimal(0))) {
    throw new DomainError('invalid_deduction', 'الخصم أكبر من أو يساوي الوزن القائم', {
      gross_kg: grossKg.toFixed(SCALE.weight),
      deduction_kg: deductionKg.toFixed(SCALE.weight),
    });
  }

  const netKg = roundWeight(netRaw);
  const pricePerKg = toPricePerKg(unitPrice, priceUnit);
  const lineTotal = roundMoney(netKg.times(pricePerKg)); // round PER LINE (FINANCIAL_RULES §1.3)

  return { netKg, deductionKg, pricePerKg, lineTotal };
}

/** Weighbridge: net = gross_in − tare_out. Contract: FR-4, golden G-4. */
export function computeWeighbridgeNet(grossInKg: Kg, tareOutKg: Kg): Kg {
  if (!gt(grossInKg, tareOutKg)) {
    throw new DomainError('invalid_weight', 'الوزن الفارغ يجب أن يكون أقل من الوزن القائم');
  }
  return roundWeight(grossInKg.minus(tareOutKg));
}

/** Sum of already-rounded line totals. NEVER sum unrounded values (FINANCIAL_RULES §1.3, G-13). */
export function sumLineTotals(totals: readonly EGP[]): EGP {
  return totals.reduce<Decimal>((acc, t) => acc.plus(t), new Decimal(0)) as EGP;
}

export const roundToScale = round;
