/**
 * Pure pay-run arithmetic. Everything here is deterministic and unit-tested;
 * the service layer only snapshots inputs and stores results.
 */
import type { AMOUNT_MODES, PAY_FREQUENCIES, PAY_PERIODS, WISE_RECIPIENT_KINDS } from '../../db/schema.js';

export type PayPeriod = (typeof PAY_PERIODS)[number];
export type PayFrequency = (typeof PAY_FREQUENCIES)[number];
export type AmountMode = (typeof AMOUNT_MODES)[number];
export type RecipientKind = (typeof WISE_RECIPIENT_KINDS)[number];

/** How Wise is told the amount for one recipient kind, and the fee to gross up by. */
export interface FeeModel {
  amountMode: AmountMode;
  /** Fixed part of Wise's fee, in the source currency. */
  feeFixed: number;
  /** Variable part of Wise's fee as a fraction of the amount sent (0.0065 = 0.65%). */
  feePct: number;
}

export const round2 = (n: number): number => Math.round(n * 100) / 100;

const PERIODS_PER_YEAR: Record<PayPeriod, number> = { weekly: 52, fortnightly: 26, monthly: 12, annual: 1 };

export function annualise(amount: number, period: PayPeriod): number {
  return amount * PERIODS_PER_YEAR[period];
}

/** Convert a compensation amount to the amount per pay-run period. */
export function perPeriod(amount: number, period: PayPeriod, frequency: PayFrequency): number {
  if (period === frequency) return round2(amount);
  return round2(annualise(amount, period) / PERIODS_PER_YEAR[frequency]);
}

/** Philippine 13th-month pay: one twelfth of basic annual pay. */
export function thirteenthMonth(amount: number, period: PayPeriod): number {
  return round2(annualise(amount, period) / 12);
}

/**
 * Amount to send so the recipient nets `net` after Wise deducts fixed + pct.
 * Rounded UP to the cent so rounding never shorts the recipient.
 */
export function grossUp(net: number, model: Pick<FeeModel, 'feeFixed' | 'feePct'>): number {
  if (model.feePct >= 1 || model.feePct < 0) throw new Error('feePct must be in [0, 1)');
  const raw = (net + model.feeFixed) / (1 - model.feePct);
  return Math.ceil(raw * 100 - 1e-7) / 100;
}

export interface ExportAmounts {
  amountMode: AmountMode;
  exportAmount: number;
  exportCurrency: string;
  grossUpAmount: number;
}

/** What goes in the Wise file for a net amount under a fee model. */
export function exportAmounts(
  net: number,
  model: FeeModel,
  sourceCurrency: string,
  targetCurrency: string | null,
): ExportAmounts {
  if (net <= 0) return { amountMode: model.amountMode, exportAmount: 0, exportCurrency: sourceCurrency, grossUpAmount: 0 };
  if (model.amountMode === 'target') {
    return { amountMode: 'target', exportAmount: round2(net), exportCurrency: targetCurrency ?? sourceCurrency, grossUpAmount: 0 };
  }
  const gross = grossUp(net, model);
  return { amountMode: 'source', exportAmount: gross, exportCurrency: sourceCurrency, grossUpAmount: round2(gross - net) };
}

/** INV + 8 with pad 4 = INV0008; "INV " + 104 with pad 0 = "INV 104". */
export function formatReference(prefix: string | null | undefined, n: number, pad: number): string {
  return `${prefix ?? ''}${String(n).padStart(Math.max(0, pad), '0')}`;
}

/** Default period covered by a pay date for a frequency, as [start, end]. */
export function defaultPeriod(payDate: string, frequency: PayFrequency): [string, string] {
  const end = new Date(payDate + 'T00:00:00Z');
  const start = new Date(end);
  if (frequency === 'weekly') start.setUTCDate(end.getUTCDate() - 6);
  else if (frequency === 'fortnightly') start.setUTCDate(end.getUTCDate() - 13);
  else start.setUTCDate(1);
  return [start.toISOString().slice(0, 10), end.toISOString().slice(0, 10)];
}

/** Two-decimal string for CSV (Wise wants plain numerals, no separators). */
export function csvAmount(n: number): string {
  return n.toFixed(2);
}
