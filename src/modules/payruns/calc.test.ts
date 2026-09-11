import { describe, expect, it } from 'vitest';
import { defaultPeriod, exportAmounts, formatReference, grossUp, perPeriod, thirteenthMonth } from './calc.js';

describe('perPeriod', () => {
  it('is identity when period matches frequency', () => {
    expect(perPeriod(208.8, 'weekly', 'weekly')).toBe(208.8);
  });
  it('converts monthly and annual to weekly via the year', () => {
    expect(perPeriod(1200, 'monthly', 'weekly')).toBe(276.92);
    expect(perPeriod(52000, 'annual', 'weekly')).toBe(1000);
    expect(perPeriod(200, 'weekly', 'monthly')).toBe(866.67);
    expect(perPeriod(400, 'fortnightly', 'weekly')).toBe(200);
  });
});

describe('thirteenthMonth', () => {
  it('is one twelfth of annual basic pay', () => {
    expect(thirteenthMonth(200, 'weekly')).toBe(866.67);
    expect(thirteenthMonth(1200, 'monthly')).toBe(1200);
  });
});

describe('grossUp', () => {
  it('returns net when there is no fee', () => {
    expect(grossUp(200, { feeFixed: 0, feePct: 0 })).toBe(200);
  });
  it('adds the fixed fee and divides by (1 - pct), rounding up to the cent', () => {
    // (200 + 1.20) / (1 - 0.0065) = 202.5163...
    expect(grossUp(200, { feeFixed: 1.2, feePct: 0.0065 })).toBe(202.52);
    // recipient nets at least 200 after the fee is taken from the grossed amount
    const g = grossUp(165.57, { feeFixed: 0.9, feePct: 0.0111 });
    expect(g - 0.9 - g * 0.0111).toBeGreaterThanOrEqual(165.57);
  });
  it('rejects a nonsense percentage', () => {
    expect(() => grossUp(1, { feeFixed: 0, feePct: 1 })).toThrow();
  });
});

describe('exportAmounts', () => {
  it('source mode grosses up in the source currency', () => {
    expect(exportAmounts(200, { amountMode: 'source', feeFixed: 1, feePct: 0.01 }, 'USD', 'PHP')).toEqual({
      amountMode: 'source',
      exportAmount: 203.04,
      exportCurrency: 'USD',
      grossUpAmount: 3.04,
    });
  });
  it('target mode sends net in the target currency', () => {
    expect(exportAmounts(254, { amountMode: 'target', feeFixed: 5, feePct: 0.5 }, 'USD', 'USD')).toEqual({
      amountMode: 'target',
      exportAmount: 254,
      exportCurrency: 'USD',
      grossUpAmount: 0,
    });
  });
  it('zero or negative net exports nothing', () => {
    expect(exportAmounts(0, { amountMode: 'source', feeFixed: 1, feePct: 0.01 }, 'USD', null).exportAmount).toBe(0);
  });
});

describe('formatReference', () => {
  it('matches the shapes seen in the real Wise file', () => {
    expect(formatReference('INV ', 104, 0)).toBe('INV 104');
    expect(formatReference('INV', 22, 3)).toBe('INV022');
    expect(formatReference('INV-', 176, 4)).toBe('INV-0176');
    expect(formatReference(null, 8, 4)).toBe('0008');
  });
});

describe('defaultPeriod', () => {
  it('covers the week ending on the pay date', () => {
    expect(defaultPeriod('2026-09-11', 'weekly')).toEqual(['2026-09-05', '2026-09-11']);
    expect(defaultPeriod('2026-09-11', 'fortnightly')).toEqual(['2026-08-29', '2026-09-11']);
    expect(defaultPeriod('2026-09-30', 'monthly')).toEqual(['2026-09-01', '2026-09-30']);
  });
});
