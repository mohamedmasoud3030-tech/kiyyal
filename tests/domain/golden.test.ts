/**
 * Golden examples — docs/FINANCIAL_RULES.md §11.
 * These results may NEVER change without an ADR.
 */
import { describe, expect, it } from 'vitest';
import {
  Decimal, egp, egpPerKg, egpPerUnit, kg, outCost, outMoney, outWeight, percent,
} from '../../src/domain/decimal.js';
import { computeLine, computeWeighbridgeNet, sumLineTotals, DomainError } from '../../src/domain/line.js';
import { applyInbound, applyCostAdjustment, computeSaleProfit, stockValue } from '../../src/domain/costing.js';
import { allocateRegrade, resolveDeferredAllocation } from '../../src/domain/regrade.js';
import { closeDifference, computeDrawer, postPendingCash } from '../../src/domain/cash.js';

describe('G-1 · 100 kg @ 20.00/kg, 5 % deduction', () => {
  it('nets 95.00 kg and totals 1,900.00', () => {
    const r = computeLine({
      grossKg: kg('100.00'), deductionType: 'percent', deductionValue: percent('5.000'),
      unitPrice: egpPerUnit('20.0000'), priceUnit: 'kg',
    });
    expect(outWeight(r.netKg)).toBe('95.00');
    expect(outMoney(r.lineTotal)).toBe('1900.00');
  });
});

describe('G-2 · 100 kg @ 20.00/kg, 12 kg deduction', () => {
  it('nets 88.00 kg and totals 1,760.00', () => {
    const r = computeLine({
      grossKg: kg('100.00'), deductionType: 'kg', deductionValue: kg('12.00'),
      unitPrice: egpPerUnit('20.0000'), priceUnit: 'kg',
    });
    expect(outWeight(r.netKg)).toBe('88.00');
    expect(outMoney(r.lineTotal)).toBe('1760.00');
  });
});

describe('G-3 · 1,250 kg @ 8,000.00 per TON', () => {
  it('derives 8.000000/kg and totals 10,000.00', () => {
    const r = computeLine({
      grossKg: kg('1250.00'), deductionType: 'none', deductionValue: new Decimal(0),
      unitPrice: egpPerUnit('8000.0000'), priceUnit: 'ton',
    });
    expect(outCost(r.pricePerKg)).toBe('8.000000');
    expect(outMoney(r.lineTotal)).toBe('10000.00');
  });

  it('the SAME material priced per kg on another line is unaffected (D20)', () => {
    const perKg = computeLine({
      grossKg: kg('1250.00'), deductionType: 'none', deductionValue: new Decimal(0),
      unitPrice: egpPerUnit('8.0000'), priceUnit: 'kg',
    });
    expect(outMoney(perKg.lineTotal)).toBe('10000.00');
  });
});

describe('G-4 · weighbridge', () => {
  it('12,400 − 4,100 = 8,300.00 kg', () => {
    expect(outWeight(computeWeighbridgeNet(kg('12400.00'), kg('4100.00')))).toBe('8300.00');
  });
  it('rejects tare >= gross', () => {
    expect(() => computeWeighbridgeNet(kg('4100.00'), kg('12400.00'))).toThrow(DomainError);
  });
});

describe('G-5 · weighted moving average', () => {
  it('1,000 @ 10.00 then 500 @ 16.00 → 12.000000/kg, value 18,000.00', () => {
    let s = { quantityKg: kg('0'), avgCostPerKg: egpPerKg('0') };
    s = applyInbound(s, kg('1000.00'), egpPerKg('10.000000'));
    s = applyInbound(s, kg('500.00'), egpPerKg('16.000000'));
    expect(outWeight(s.quantityKg)).toBe('1500.00');
    expect(outCost(s.avgCostPerKg)).toBe('12.000000');
    expect(outMoney(stockValue(s))).toBe('18000.00');
  });
});

describe('G-6 · sale profit', () => {
  it('400 kg @ 20.00 against avg 12.00 → profit 3,200.00, margin 40.000 %', () => {
    const p = computeSaleProfit(kg('400.00'), egp('8000.00'), egpPerKg('12.000000'));
    expect(outMoney(p.costAmount)).toBe('4800.00');
    expect(outMoney(p.grossProfit!)).toBe('3200.00');
    expect(p.marginPct!.toFixed(3)).toBe('40.000');
  });
});

describe('G-7 · zero-cost sale', () => {
  it('reports "غير محسوب", never a 100 % margin', () => {
    const p = computeSaleProfit(kg('100.00'), egp('1500.00'), egpPerKg('0'));
    expect(p.uncomputable).toBe(true);
    expect(p.grossProfit).toBeNull();
    expect(p.marginPct).toBeNull();
  });
});

describe('G-8 · regrade by relative sales value', () => {
  const alloc = allocateRegrade(kg('1000.00'), egpPerKg('20.000000'), [
    { materialId: 'copper', kg: kg('100.00'), refSellPricePerKg: egpPerKg('400.000000') },
    { materialId: 'iron', kg: kg('900.00'), refSellPricePerKg: egpPerKg('8.000000') },
  ]);

  it('consumes 20,000.00', () => expect(outMoney(alloc.consumedValue)).toBe('20000.00'));
  it('copper gets 16,949.15 (169.491500/kg)', () => {
    const c = alloc.outputs.find((o) => o.materialId === 'copper')!;
    expect(outMoney(c.allocatedValue)).toBe('16949.15');
    expect(outCost(c.allocatedCostPerKg)).toBe('169.491500');
  });
  it('iron gets 3,050.85 (3.389833/kg)', () => {
    const i = alloc.outputs.find((o) => o.materialId === 'iron')!;
    expect(outMoney(i.allocatedValue)).toBe('3050.85');
    expect(outCost(i.allocatedCostPerKg)).toBe('3.389833');
  });
  it('allocations sum to the consumed value EXACTLY (DB-9)', () => {
    const sum = alloc.outputs.reduce((a, o) => a.plus(o.allocatedValue), new Decimal(0));
    expect(sum.toFixed(2)).toBe('20000.00');
  });
  it('is NOT weight allocation — copper and iron differ by ~50x per kg', () => {
    const c = alloc.outputs.find((o) => o.materialId === 'copper')!;
    const i = alloc.outputs.find((o) => o.materialId === 'iron')!;
    expect(c.allocatedCostPerKg.toNumber()).toBeGreaterThan(i.allocatedCostPerKg.toNumber() * 40);
  });
});

describe('G-9 · deferred allocation resolution (D33)', () => {
  const deferred = allocateRegrade(kg('1000.00'), egpPerKg('20.000000'), [
    { materialId: 'copper', kg: kg('100.00'), refSellPricePerKg: null },
    { materialId: 'iron', kg: kg('900.00'), refSellPricePerKg: egpPerKg('8.000000') },
  ]);

  it('defers ALL of the cost, not part of it', () => {
    expect(deferred.deferred).toBe(true);
    expect(deferred.outputs).toHaveLength(0);
    expect(outMoney(deferred.unallocatedValue!)).toBe('20000.00');
  });

  const res = resolveDeferredAllocation(egp('20000.00'), [
    { materialId: 'copper', originalKg: kg('100.00'), refSellPricePerKg: egpPerKg('400.000000'), soldKgSinceRegrade: kg('50.00') },
    { materialId: 'iron', originalKg: kg('900.00'), refSellPricePerKg: egpPerKg('8.000000'), soldKgSinceRegrade: kg('400.00') },
  ]);

  it('copper: 8,474.58 unattributed / 8,474.58 to inventory', () => {
    const c = res.outputs.find((o) => o.materialId === 'copper')!;
    expect(outMoney(c.allocatedValue)).toBe('16949.15');
    expect(outMoney(c.unattributedValue)).toBe('8474.58');
    expect(outMoney(c.toInventoryValue)).toBe('8474.57');
  });
  it('iron: 1,355.93 unattributed / 1,694.92 to inventory', () => {
    const i = res.outputs.find((o) => o.materialId === 'iron')!;
    expect(outMoney(i.allocatedValue)).toBe('3050.85');
    expect(outMoney(i.unattributedValue)).toBe('1355.93');
    expect(outMoney(i.toInventoryValue)).toBe('1694.92');
  });
  it('totals: unattributed + to-inventory = 20,000.00 EXACTLY', () => {
    const total = res.totalUnattributed.plus(res.totalToInventory);
    expect(total.toFixed(2)).toBe('20000.00');
  });
  it('the whole cost is NOT loaded onto remaining stock', () => {
    expect(res.totalToInventory.lessThan(res.consumedValue)).toBe(true);
    expect(outMoney(res.totalUnattributed)).toBe('9830.51');
  });
});

describe('G-10 / G-11 · drawer with pending cash', () => {
  const drawer = computeDrawer(egp('45000.00'), [
    { id: '1', direction: 'in', amount: egp('20000.00'), status: 'posted' },
    { id: '2', direction: 'out', amount: egp('8000.00'), status: 'posted' },
    { id: '3', direction: 'in', amount: egp('12000.00'), status: 'pending', transactionId: 't1' },
  ]);

  it('posted expected = 57,000.00', () => expect(outMoney(drawer.expectedPosted)).toBe('57000.00'));
  it('pending = 12,000.00', () => expect(outMoney(drawer.pendingCash)).toBe('12000.00'));
  it('drawer expected = 69,000.00', () => expect(outMoney(drawer.expectedInDrawer)).toBe('69000.00'));
  it('counted 68,600.00 → difference −400.00', () => {
    expect(outMoney(closeDifference(egp('68600.00'), drawer.expectedInDrawer))).toBe('-400.00');
  });
  it('pending cash is EXCLUDED from the posted line (D32)', () => {
    expect(drawer.expectedPosted.equals(new Decimal('57000.00'))).toBe(true);
  });
});

describe('G-12 · closed-day cost adjustment', () => {
  it('delta −400 over 500 kg @ 12.00 → new avg 11.200000', () => {
    const after = applyCostAdjustment({ quantityKg: kg('500.00'), avgCostPerKg: egpPerKg('12.000000') }, egp('-400.00'));
    expect(outCost(after.avgCostPerKg)).toBe('11.200000');
    expect(outWeight(after.quantityKg)).toBe('500.00');
  });
});

describe('G-13 · per-line rounding, never sum-then-round', () => {
  it('three lines of 10.005 → 30.03, not 30.02', () => {
    const lines = ['10.005', '10.005', '10.005'].map((p) =>
      computeLine({
        grossKg: kg('1.00'), deductionType: 'none', deductionValue: new Decimal(0),
        unitPrice: egpPerUnit(p), priceUnit: 'kg',
      }).lineTotal,
    );
    expect(lines.map((l) => outMoney(l))).toEqual(['10.01', '10.01', '10.01']);
    expect(outMoney(sumLineTotals(lines))).toBe('30.03');
    // The wrong way, for contrast:
    const wrong = new Decimal('10.005').times(3).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    expect(wrong.toFixed(2)).toBe('30.02');
  });
});

describe('G-14 · pending → posted produces exactly one movement', () => {
  it('same id, same amount, status flipped', () => {
    const pending = { id: 'cm-1', direction: 'in' as const, amount: egp('12000.00'), status: 'pending' as const, transactionId: 't1' };
    const posted = postPendingCash(pending);
    expect(posted.id).toBe(pending.id);
    expect(outMoney(posted.amount)).toBe('12000.00');
    expect(posted.status).toBe('posted');
    expect(() => postPendingCash(posted)).toThrow('cash_movement_not_pending');
  });
});
