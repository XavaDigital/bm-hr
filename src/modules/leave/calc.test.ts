import { describe, expect, it } from 'vitest';
import { accruedToDate, completedMonths, computeBalance, leaveYearFor, proratedEntitlement, workingDays, type PolicyLike } from './calc.js';

const policy: PolicyLike = { leaveYearStart: '01-01', annualEntitlementDays: 12, accrual: 'monthly', carryOverMaxDays: 5, sickDays: 5 };

describe('workingDays', () => {
  it('counts Mon–Fri inclusive', () => {
    expect(workingDays('2026-09-07', '2026-09-11')).toBe(5); // Mon–Fri
    expect(workingDays('2026-09-11', '2026-09-14')).toBe(2); // Fri, Mon
    expect(workingDays('2026-09-12', '2026-09-13')).toBe(0); // weekend
    expect(workingDays('2026-09-14', '2026-09-11')).toBe(0);
  });
});

describe('leaveYearFor', () => {
  it('handles calendar and April leave years', () => {
    expect(leaveYearFor('01-01', '2026-09-12')).toEqual(['2026-01-01', '2026-12-31']);
    expect(leaveYearFor('04-01', '2026-09-12')).toEqual(['2026-04-01', '2027-03-31']);
    expect(leaveYearFor('04-01', '2026-02-10')).toEqual(['2025-04-01', '2026-03-31']);
  });
});

describe('completedMonths / prorating', () => {
  it('counts whole months', () => {
    expect(completedMonths('2026-01-01', '2026-09-12')).toBe(8);
    expect(completedMonths('2026-01-15', '2026-09-14')).toBe(7);
    expect(completedMonths('2026-01-15', '2026-09-15')).toBe(8);
  });
  it('pro-rates by calendar days for a mid-year start', () => {
    expect(proratedEntitlement(12, '2026-01-01', '2026-12-31', null)).toBe(12);
    expect(proratedEntitlement(12, '2026-01-01', '2026-12-31', '2026-07-01')).toBe(6.05);
    expect(proratedEntitlement(12, '2026-01-01', '2026-12-31', '2027-01-01')).toBe(0);
  });
  it('accrues monthly, capped at the prorated entitlement; front-loaded is immediate', () => {
    expect(accruedToDate(policy, '2026-01-01', '2026-12-31', null, '2026-09-12')).toBe(8);
    expect(accruedToDate(policy, '2026-01-01', '2026-12-31', '2026-07-01', '2026-09-12')).toBe(2);
    expect(accruedToDate({ ...policy, accrual: 'front_loaded' }, '2026-01-01', '2026-12-31', null, '2026-01-02')).toBe(12);
    expect(accruedToDate(policy, '2026-01-01', '2026-12-31', null, '2026-12-31')).toBe(12);
  });
});

describe('computeBalance', () => {
  it('for a long-tenured person: carry-in capped, accrual, taken vs booked vs pending', () => {
    const b = computeBalance(
      policy,
      '2024-03-04',
      [
        { type: 'annual', startDate: '2025-06-02', endDate: '2025-06-03', days: 2, status: 'approved', paid: true }, // last year: 12 − 2 = 10 → capped to 5
        { type: 'annual', startDate: '2026-03-02', endDate: '2026-03-04', days: 3, status: 'approved', paid: true },
        { type: 'annual', startDate: '2026-10-05', endDate: '2026-10-06', days: 2, status: 'approved', paid: true },
        { type: 'annual', startDate: '2026-11-02', endDate: '2026-11-02', days: 1, status: 'requested', paid: true },
        { type: 'annual', startDate: '2026-04-01', endDate: '2026-04-01', days: 1, status: 'cancelled', paid: true },
        { type: 'sick', startDate: '2026-02-10', endDate: '2026-02-10', days: 1, status: 'approved', paid: true },
        { type: 'unpaid', startDate: '2026-05-11', endDate: '2026-05-11', days: 1, status: 'approved', paid: false },
      ],
      [{ date: '2026-01-15', days: 1.5 }],
      '2026-09-12',
    );
    expect(b).toMatchObject({
      yearStart: '2026-01-01',
      yearEnd: '2026-12-31',
      carryIn: 5,
      entitlement: 12,
      accruedToDate: 8,
      adjustments: 1.5,
      taken: 3,
      booked: 2,
      pending: 1,
      available: 9.5,
      availableAtYearEnd: 13.5,
      sickTaken: 1,
      sickDays: 5,
      unpaidTaken: 1,
    });
  });

  it('carries the 2024 partial-year balance through 2025 into 2026', () => {
    // started 2024-10-01: 2024 entitlement ≈ 3.02, none taken → carry 3.02 into 2025;
    // 2025: 3.02 + 12 = 15.02, took 4 → 11.02 → capped to 5 into 2026
    const b = computeBalance(
      policy,
      '2024-10-01',
      [{ type: 'annual', startDate: '2025-08-04', endDate: '2025-08-07', days: 4, status: 'approved', paid: true }],
      [],
      '2026-02-01',
    );
    expect(b.carryIn).toBe(5);
    expect(b.accruedToDate).toBe(1);
    expect(b.available).toBe(6);
  });

  it('a negative closing balance carries through uncapped', () => {
    const b = computeBalance(
      policy,
      '2025-01-01',
      [{ type: 'annual', startDate: '2025-03-03', endDate: '2025-03-21', days: 15, status: 'approved', paid: true }],
      [],
      '2026-02-01',
    );
    expect(b.carryIn).toBe(-3);
    expect(b.available).toBe(-2); // one month accrued
  });

  it('new starter this year, front-loaded', () => {
    const b = computeBalance({ ...policy, accrual: 'front_loaded' }, '2026-07-01', [], [], '2026-09-12');
    expect(b.carryIn).toBe(0);
    expect(b.entitlement).toBe(6.05);
    expect(b.accruedToDate).toBe(6.05);
    expect(b.available).toBe(6.05);
  });
});
