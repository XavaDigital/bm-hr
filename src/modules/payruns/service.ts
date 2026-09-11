/**
 * Pay runs (PLAN.md §5). A run is created for a pay date, pre-filled from
 * every eligible member's current pay and schedule; lines can be adjusted
 * while the run is a draft; export freezes the lines, assigns invoice
 * references and hands back the Wise batch CSV; mark-paid closes it.
 */
import { and, desc, eq, inArray, ne } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { payRunLines, payRuns, paySchedules, type PayRun, type PayRunLine } from '../../db/schema.js';
import { recordAudit, type Actor } from '../../audit.js';
import { ApiError } from '../../http/errors.js';
import { toCsv } from '../members/csv.js';
import { getMember, listMembers, type MemberSummary } from '../members/service.js';
import { getWiseSettings, type WiseSettings } from '../settings/service.js';
import {
  csvAmount,
  defaultPeriod,
  exportAmounts,
  formatReference,
  perPeriod,
  round2,
  thirteenthMonth,
  type FeeModel,
  type PayFrequency,
  type PayPeriod,
  type RecipientKind,
} from './calc.js';

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

const NUMERIC_LINE_FIELDS = [
  'baseAmount',
  'thirteenthMonthAmount',
  'adjustmentsAmount',
  'netAmount',
  'feeFixed',
  'feePct',
  'grossUpAmount',
  'exportAmount',
] as const;
type NumericLineField = (typeof NUMERIC_LINE_FIELDS)[number];

export type LineView = Omit<PayRunLine, NumericLineField> & Record<NumericLineField, number>;

export interface LineIssue {
  lineId: string;
  memberName: string;
  level: 'error' | 'warning';
  message: string;
}

export interface RunTotals {
  lines: number;
  included: number;
  netAmount: number;
  exportAmount: number;
  grossUpAmount: number;
}

export interface RunView {
  run: PayRun;
  lines: LineView[];
  totals: RunTotals;
  issues: LineIssue[];
}

export interface RunSummary {
  run: PayRun;
  totals: RunTotals;
}

const num = (s: string): number => Number(s);
const str = (n: number): string => n.toFixed(2);

export function toLineView(l: PayRunLine): LineView {
  const out = { ...l } as unknown as LineView;
  for (const f of NUMERIC_LINE_FIELDS) (out as Record<string, unknown>)[f] = num(l[f]);
  return out;
}

function totalsOf(lines: LineView[]): RunTotals {
  const inc = lines.filter((l) => l.included);
  return {
    lines: lines.length,
    included: inc.length,
    netAmount: round2(inc.reduce((s, l) => s + l.netAmount, 0)),
    exportAmount: round2(inc.reduce((s, l) => s + l.exportAmount, 0)),
    grossUpAmount: round2(inc.reduce((s, l) => s + l.grossUpAmount, 0)),
  };
}

/** Problems that block export (error) or deserve a look (warning). */
export function validateRun(run: PayRun, lines: LineView[]): LineIssue[] {
  const issues: LineIssue[] = [];
  const seen = new Map<string, string>();
  for (const l of lines.filter((x) => x.included)) {
    const add = (level: LineIssue['level'], message: string) => issues.push({ lineId: l.id, memberName: l.memberName, level, message });
    if (!l.recipientId) add('error', 'No Wise recipientId on the pay schedule');
    if (!l.recipientName) add('error', 'No Wise recipient name on the pay schedule');
    if (!l.recipientKind) add('error', 'Recipient kind (GCash / Wise account) not set');
    if (l.exportAmount <= 0) add('error', 'Amount is zero');
    if (l.baseAmount <= 0) add('warning', 'No current compensation in the run currency');
    if (l.amountMode === 'target' && l.recipientKind === 'gcash' && l.targetCurrency && l.targetCurrency !== run.sourceCurrency) {
      add('error', `Target mode needs a ${l.targetCurrency} amount; set GCash to source mode in Settings`);
    }
    if (l.amountMode === 'source' && l.feeFixed === 0 && l.feePct === 0) {
      add('warning', 'No fee model set: Wise will take its fee out of the recipient amount');
    }
    if (!l.paymentReference) add('warning', 'No payment reference');
    if (l.recipientId) {
      const other = seen.get(l.recipientId);
      if (other) add('error', `Same Wise recipient as ${other}`);
      seen.set(l.recipientId, l.memberName);
    }
  }
  return issues;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

async function findRun(id: string): Promise<PayRun> {
  const [run] = await db.select().from(payRuns).where(eq(payRuns.id, id));
  if (!run) throw new ApiError(404, 'Pay run not found');
  return run;
}

function assertDraft(run: PayRun): void {
  if (run.status !== 'draft') throw new ApiError(409, `Pay run is ${run.status}; reopen it to edit`, 'NOT_DRAFT');
}

export async function listPayRuns(): Promise<RunSummary[]> {
  const runs = await db.select().from(payRuns).orderBy(desc(payRuns.payDate), desc(payRuns.createdAt));
  if (runs.length === 0) return [];
  const lines = await db
    .select()
    .from(payRunLines)
    .where(
      inArray(
        payRunLines.payRunId,
        runs.map((r) => r.id),
      ),
    );
  const by = new Map<string, LineView[]>();
  for (const l of lines) by.set(l.payRunId, [...(by.get(l.payRunId) ?? []), toLineView(l)]);
  return runs.map((run) => ({ run, totals: totalsOf(by.get(run.id) ?? []) }));
}

export async function getPayRun(id: string): Promise<RunView> {
  const run = await findRun(id);
  const rows = await db.select().from(payRunLines).where(eq(payRunLines.payRunId, id)).orderBy(payRunLines.memberName);
  const lines = rows.map(toLineView);
  return { run, lines, totals: totalsOf(lines), issues: validateRun(run, lines) };
}

// ---------------------------------------------------------------------------
// Line construction
// ---------------------------------------------------------------------------

const NO_FEE: FeeModel = { amountMode: 'source', feeFixed: 0, feePct: 0 };

function eligible(m: MemberSummary, run: PayRun): boolean {
  const s = m.schedule;
  if (!s || s.payoutMethod !== 'wise' || s.frequency !== run.frequency) return false;
  if (m.member.startDate && m.member.startDate > run.payDate) return false;
  if (m.member.endDate && run.periodStart && m.member.endDate < run.periodStart) return false;
  return true;
}

/** Has this member already had a 13th-month amount in another run paid in the same month? */
async function thirteenthAlreadyInMonth(memberId: string, payDate: string, excludeRunId: string): Promise<boolean> {
  const rows = await db
    .select({ amount: payRunLines.thirteenthMonthAmount, payDate: payRuns.payDate })
    .from(payRunLines)
    .innerJoin(payRuns, eq(payRuns.id, payRunLines.payRunId))
    .where(and(eq(payRunLines.memberId, memberId), ne(payRuns.id, excludeRunId)));
  const ym = payDate.slice(0, 7);
  return rows.some((r) => num(r.amount) > 0 && r.payDate.slice(0, 7) === ym);
}

async function buildLine(
  run: PayRun,
  m: MemberSummary,
  wise: WiseSettings,
  existing?: PayRunLine,
): Promise<typeof payRunLines.$inferInsert> {
  const s = m.schedule;
  const pay =
    m.currentPay && m.currentPay.currency === run.sourceCurrency
      ? { amount: m.currentPay.amount, period: m.currentPay.period as PayPeriod }
      : null;
  const base = pay ? perPeriod(pay.amount, pay.period, run.frequency as PayFrequency) : 0;

  let thirteenth = existing ? num(existing.thirteenthMonthAmount) : 0;
  if (!existing && s?.thirteenthMonth && pay && Number(run.payDate.slice(5, 7)) === s.thirteenthMonthPayMonth) {
    if (!(await thirteenthAlreadyInMonth(m.member.id, run.payDate, run.id))) thirteenth = thirteenthMonth(pay.amount, pay.period);
  }
  const adjustments = existing ? num(existing.adjustmentsAmount) : 0;
  const kind = (s?.wiseRecipientKind ?? null) as RecipientKind | null;
  const model = kind ? wise.kinds[kind] : NO_FEE;
  const net = round2(base + thirteenth + adjustments);
  const ex = exportAmounts(net, model, run.sourceCurrency, s?.targetCurrency ?? null);
  const manualRef = existing?.paymentReferenceManual ?? false;
  const previewRef = s && s.nextInvoiceNumber !== null ? formatReference(s.invoicePrefix, s.nextInvoiceNumber, s.invoicePad) : null;

  return {
    payRunId: run.id,
    memberId: m.member.id,
    included: existing?.included ?? true,
    memberName: `${m.member.firstName} ${m.member.lastName}`.trim(),
    baseAmount: str(base),
    thirteenthMonthAmount: str(thirteenth),
    adjustmentsAmount: str(adjustments),
    adjustmentsNote: existing?.adjustmentsNote ?? null,
    netAmount: str(net),
    amountMode: ex.amountMode,
    feeFixed: str(model.feeFixed),
    feePct: model.feePct.toFixed(6),
    grossUpAmount: str(ex.grossUpAmount),
    exportAmount: str(ex.exportAmount),
    exportCurrency: ex.exportCurrency,
    paymentReference: manualRef ? (existing?.paymentReference ?? null) : previewRef,
    paymentReferenceManual: manualRef,
    recipientId: s?.wiseRecipientId ?? null,
    recipientName: s?.wiseRecipientName ?? null,
    recipientEmail: s?.wiseRecipientEmail ?? null,
    recipientDetail: s?.wiseRecipientDetail ?? null,
    recipientKind: kind,
    targetCurrency: s?.targetCurrency ?? null,
    updatedAt: new Date(),
  };
}

/** Recompute net/export from a line's own stored fields (after an edit). */
function recalc(run: PayRun, line: PayRunLine): Partial<typeof payRunLines.$inferInsert> {
  const net = round2(num(line.baseAmount) + num(line.thirteenthMonthAmount) + num(line.adjustmentsAmount));
  const ex = exportAmounts(
    net,
    { amountMode: line.amountMode as FeeModel['amountMode'], feeFixed: num(line.feeFixed), feePct: num(line.feePct) },
    run.sourceCurrency,
    line.targetCurrency,
  );
  return { netAmount: str(net), grossUpAmount: str(ex.grossUpAmount), exportAmount: str(ex.exportAmount), exportCurrency: ex.exportCurrency, updatedAt: new Date() };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export interface CreateRunInput {
  payDate: string;
  frequency: PayFrequency;
  periodStart?: string | null;
  periodEnd?: string | null;
  notes?: string | null;
}

export async function createPayRun(input: CreateRunInput, actor?: Actor): Promise<RunView> {
  const wise = await getWiseSettings();
  const [ps, pe] = defaultPeriod(input.payDate, input.frequency);
  const [run] = await db
    .insert(payRuns)
    .values({
      payDate: input.payDate,
      frequency: input.frequency,
      periodStart: input.periodStart ?? ps,
      periodEnd: input.periodEnd ?? pe,
      sourceCurrency: wise.sourceCurrency,
      notes: input.notes ?? null,
      createdBy: actor?.id ?? null,
      createdByEmail: actor?.email ?? null,
    })
    .returning();
  const members = await listMembers({ status: ['active', 'onboarding'] });
  for (const m of members) {
    if (!eligible(m, run!)) continue;
    await db.insert(payRunLines).values(await buildLine(run!, m, wise));
  }
  await recordAudit(actor, 'pay_runs', run!.id, 'create', { payDate: run!.payDate, frequency: run!.frequency });
  return getPayRun(run!.id);
}

export async function updatePayRun(
  id: string,
  patch: { payDate?: string; periodStart?: string | null; periodEnd?: string | null; notes?: string | null },
  actor?: Actor,
): Promise<RunView> {
  const run = await findRun(id);
  if (patch.payDate !== undefined || patch.periodStart !== undefined || patch.periodEnd !== undefined) assertDraft(run);
  await db
    .update(payRuns)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(payRuns.id, id));
  await recordAudit(actor, 'pay_runs', id, 'update', patch);
  return getPayRun(id);
}

export async function deletePayRun(id: string, actor?: Actor): Promise<void> {
  const run = await findRun(id);
  assertDraft(run);
  await db.delete(payRunLines).where(eq(payRunLines.payRunId, id));
  await db.delete(payRuns).where(eq(payRuns.id, id));
  await recordAudit(actor, 'pay_runs', id, 'delete', { payDate: run.payDate });
}

/** Re-pull base pay, fee model and recipient details for every line; add newly eligible members. */
export async function refreshPayRun(id: string, actor?: Actor): Promise<RunView> {
  const run = await findRun(id);
  assertDraft(run);
  const wise = await getWiseSettings();
  const existing = await db.select().from(payRunLines).where(eq(payRunLines.payRunId, id));
  const byMember = new Map(existing.map((l) => [l.memberId, l]));
  for (const m of await listMembers({ status: ['active', 'onboarding'] })) {
    const line = byMember.get(m.member.id);
    if (line) {
      const { payRunId: _p, memberId: _m, ...values } = await buildLine(run, m, wise, line);
      await db.update(payRunLines).set(values).where(eq(payRunLines.id, line.id));
    } else if (eligible(m, run)) {
      await db.insert(payRunLines).values(await buildLine(run, m, wise));
    }
  }
  await recordAudit(actor, 'pay_runs', id, 'update', { refreshed: true });
  return getPayRun(id);
}

export async function addLine(runId: string, memberId: string, actor?: Actor): Promise<RunView> {
  const run = await findRun(runId);
  assertDraft(run);
  const m = await getMember(memberId);
  if (!m.schedule) throw new ApiError(400, 'That person has no pay schedule yet');
  const [dupe] = await db
    .select({ id: payRunLines.id })
    .from(payRunLines)
    .where(and(eq(payRunLines.payRunId, runId), eq(payRunLines.memberId, memberId)));
  if (dupe) throw new ApiError(409, 'Already in this run');
  await db.insert(payRunLines).values(await buildLine(run, m, await getWiseSettings()));
  await recordAudit(actor, 'pay_run_lines', `${runId}/${memberId}`, 'create');
  return getPayRun(runId);
}

export interface LinePatch {
  included?: boolean;
  thirteenthMonthAmount?: number;
  adjustmentsAmount?: number;
  adjustmentsNote?: string | null;
  paymentReference?: string | null;
}

export async function updateLine(runId: string, lineId: string, patch: LinePatch, actor?: Actor): Promise<RunView> {
  const run = await findRun(runId);
  assertDraft(run);
  const [line] = await db
    .select()
    .from(payRunLines)
    .where(and(eq(payRunLines.id, lineId), eq(payRunLines.payRunId, runId)));
  if (!line) throw new ApiError(404, 'Line not found');
  const merged: PayRunLine = {
    ...line,
    included: patch.included ?? line.included,
    thirteenthMonthAmount: patch.thirteenthMonthAmount !== undefined ? str(patch.thirteenthMonthAmount) : line.thirteenthMonthAmount,
    adjustmentsAmount: patch.adjustmentsAmount !== undefined ? str(patch.adjustmentsAmount) : line.adjustmentsAmount,
    adjustmentsNote: patch.adjustmentsNote !== undefined ? patch.adjustmentsNote : line.adjustmentsNote,
  };
  const refPatch =
    patch.paymentReference !== undefined
      ? { paymentReference: patch.paymentReference || null, paymentReferenceManual: !!patch.paymentReference }
      : {};
  await db
    .update(payRunLines)
    .set({
      included: merged.included,
      thirteenthMonthAmount: merged.thirteenthMonthAmount,
      adjustmentsAmount: merged.adjustmentsAmount,
      adjustmentsNote: merged.adjustmentsNote,
      ...refPatch,
      ...recalc(run, merged),
    })
    .where(eq(payRunLines.id, lineId));
  await recordAudit(actor, 'pay_run_lines', lineId, 'update', patch);
  return getPayRun(runId);
}

export async function removeLine(runId: string, lineId: string, actor?: Actor): Promise<RunView> {
  const run = await findRun(runId);
  assertDraft(run);
  await db.delete(payRunLines).where(and(eq(payRunLines.id, lineId), eq(payRunLines.payRunId, runId)));
  await recordAudit(actor, 'pay_run_lines', lineId, 'delete');
  return getPayRun(runId);
}

/**
 * Freeze the run: validation must pass, invoice references are assigned from
 * each schedule's sequence (and the sequence advanced), status → exported.
 * An assigned reference is then locked (`paymentReferenceManual`), so
 * reopening and re-exporting never consumes a second number.
 */
export async function exportPayRun(id: string, actor?: Actor): Promise<RunView> {
  const view = await getPayRun(id);
  if (view.run.status === 'exported') return view;
  assertDraft(view.run);
  const errors = view.issues.filter((i) => i.level === 'error');
  if (errors.length > 0) throw new ApiError(400, 'Pay run has problems that block export', 'RUN_INVALID', errors);

  for (const l of view.lines.filter((x) => x.included && !x.paymentReferenceManual)) {
    const [s] = await db.select().from(paySchedules).where(eq(paySchedules.memberId, l.memberId));
    if (!s || s.nextInvoiceNumber === null) continue;
    const ref = formatReference(s.invoicePrefix, s.nextInvoiceNumber, s.invoicePad);
    await db
      .update(payRunLines)
      .set({ paymentReference: ref, paymentReferenceManual: true, updatedAt: new Date() })
      .where(eq(payRunLines.id, l.id));
    await db
      .update(paySchedules)
      .set({ nextInvoiceNumber: s.nextInvoiceNumber + 1, updatedAt: new Date() })
      .where(eq(paySchedules.memberId, l.memberId));
  }
  await db.update(payRuns).set({ status: 'exported', exportedAt: new Date(), updatedAt: new Date() }).where(eq(payRuns.id, id));
  await recordAudit(actor, 'pay_runs', id, 'update', { status: 'exported', totals: view.totals });
  return getPayRun(id);
}

export async function markPaid(id: string, actor?: Actor): Promise<RunView> {
  const run = await findRun(id);
  if (run.status !== 'exported') throw new ApiError(409, 'Export the run before marking it paid', 'NOT_EXPORTED');
  await db.update(payRuns).set({ status: 'paid', paidAt: new Date(), updatedAt: new Date() }).where(eq(payRuns.id, id));
  await recordAudit(actor, 'pay_runs', id, 'update', { status: 'paid' });
  return getPayRun(id);
}

/** exported → draft, for when Wise rejected the file. Consumed invoice numbers stay consumed. */
export async function reopenPayRun(id: string, actor?: Actor): Promise<RunView> {
  const run = await findRun(id);
  if (run.status !== 'exported') throw new ApiError(409, 'Only an exported run can be reopened', 'NOT_EXPORTED');
  await db.update(payRuns).set({ status: 'draft', exportedAt: null, updatedAt: new Date() }).where(eq(payRuns.id, id));
  await recordAudit(actor, 'pay_runs', id, 'update', { status: 'draft', reopened: true });
  return getPayRun(id);
}

// ---------------------------------------------------------------------------
// Wise CSV
// ---------------------------------------------------------------------------

function cellFor(header: string, run: PayRun, l: LineView): string {
  switch (header) {
    case 'recipientId':
      return l.recipientId ?? '';
    case 'name':
      return l.recipientName ?? l.memberName;
    case 'recipientEmail':
      return l.recipientEmail ?? '';
    case 'recipientDetail':
      return l.recipientDetail ?? '';
    case 'sourceCurrency':
      return run.sourceCurrency;
    case 'targetCurrency':
      return l.targetCurrency ?? '';
    case 'amountCurrency':
      return l.amountMode;
    case 'amount':
      return csvAmount(l.exportAmount);
    case 'paymentReference':
      return l.paymentReference ?? '';
    case 'receiverType':
      return 'PERSON';
    default:
      return '';
  }
}

export async function payRunCsv(id: string): Promise<{ filename: string; csv: string }> {
  const view = await getPayRun(id);
  const { headers } = await getWiseSettings();
  const rows = view.lines
    .filter((l) => l.included)
    .sort((a, b) => (a.recipientName ?? a.memberName).localeCompare(b.recipientName ?? b.memberName))
    .map((l) => headers.map((h) => cellFor(h, view.run, l)));
  const suffix = view.run.status === 'draft' ? '-DRAFT' : '';
  return { filename: `wise-batch-${view.run.payDate}${suffix}.csv`, csv: toCsv(headers, rows) };
}

// ---------------------------------------------------------------------------
// Per-member history
// ---------------------------------------------------------------------------

export interface PayHistoryEntry {
  runId: string;
  payDate: string;
  periodStart: string | null;
  periodEnd: string | null;
  status: string;
  baseAmount: number;
  thirteenthMonthAmount: number;
  adjustmentsAmount: number;
  adjustmentsNote: string | null;
  netAmount: number;
  exportAmount: number;
  exportCurrency: string;
  paymentReference: string | null;
}

export async function payHistory(memberId: string): Promise<PayHistoryEntry[]> {
  const rows = await db
    .select({ line: payRunLines, run: payRuns })
    .from(payRunLines)
    .innerJoin(payRuns, eq(payRuns.id, payRunLines.payRunId))
    .where(and(eq(payRunLines.memberId, memberId), eq(payRunLines.included, true), inArray(payRuns.status, ['exported', 'paid'])))
    .orderBy(desc(payRuns.payDate));
  return rows.map(({ line, run }) => ({
    runId: run.id,
    payDate: run.payDate,
    periodStart: run.periodStart,
    periodEnd: run.periodEnd,
    status: run.status,
    baseAmount: num(line.baseAmount),
    thirteenthMonthAmount: num(line.thirteenthMonthAmount),
    adjustmentsAmount: num(line.adjustmentsAmount),
    adjustmentsNote: line.adjustmentsNote,
    netAmount: num(line.netAmount),
    exportAmount: num(line.exportAmount),
    exportCurrency: line.exportCurrency,
    paymentReference: line.paymentReference,
  }));
}
