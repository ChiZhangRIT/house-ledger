import test from 'node:test';
import assert from 'node:assert/strict';
import { blankState } from '../src/core/store.js';
import { buildRentLedger, rentReceipts, rentRecordSummary, validateRentRecord } from '../src/core/rent.js';

test('房租应收、收款和统计不包含 Utility 或未分类旧收款', () => {
  const s = blankState(); s.settings = { ledgerStart: '2026-10', rentCycleDay: 1 };
  s.data.residents.r = { id: 'r', moveIn: '2026-10-01', rent: [{ from: '2026-10-01', amount: 1000 }], rentSchedules: [{ from: '2026-10-01', cycleDay: 1, dueDay: 1, dueMonthOffset: 0 }] };
  s.data.bills.b = { id: 'b', total: 99, collectPeriod: '2026-10', allocation: { mode: 'locked', shares: { r: 99 } } };
  s.data.payments.a = { id: 'a', residentId: 'r', date: '2026-10-03', amount: 400, purpose: 'rent', rentId: 'rp:r:2026-10-01' };
  s.data.payments.b = { id: 'b', residentId: 'r', date: '2026-10-04', amount: 99, purpose: 'utility' };
  s.data.payments.c = { id: 'c', residentId: 'r', date: '2026-10-04', amount: 500 };
  const L = buildRentLedger(s, '2026-10-10');
  assert.equal(L.people.r.balance, 600); assert.equal(L.period('2026-10').billE, 0);
  assert.deepEqual(rentReceipts(s).values, [400]); assert.equal(s.data.bills.b.total, 99);
});

test('原表勾选和未知金额不伪造成房租收入', () => {
  const s = blankState(); s.data.rents.old = { id: 'old', paid: true, amount: null, periodStart: '2024-01-16' };
  assert.deepEqual(rentReceipts(s).months, []);
});

test('所有房租按确认的到账日期统计，未知日期不猜测，未知应收不生成欠款', () => {
  const s = blankState(); s.settings = { ledgerStart: '2026-10', rentCycleDay: 1 };
  s.data.residents.r = { id: 'r', name: 'A', moveIn: '2026-01-01', rent: [{ from: '2026-01-01', amount: 1000 }], rentSchedules: [{ from: '2026-01-01', cycleDay: 1, dueDay: 1, dueMonthOffset: 0 }] };
  s.data.rents = {
    a: { id: 'a', residentId: 'r', periodStart: '2026-07-01', paid: true, amount: null },
    b: { id: 'b', residentId: 'r', periodStart: '2026-08-01', paid: true, history: true, receivedAmount: 900, amount: 5000, paidDate: '2026-09-02' },
    c: { id: 'c', residentId: 'r', periodStart: '2026-09-01', paid: true, history: true, receivedAmount: 0, paidDate: '2026-09-05' },
    gone: { id: 'gone', residentId: 'r', periodStart: '2026-09-01', paid: true, receivedAmount: 99, deleted: true },
  };
  const summary = rentRecordSummary(s);
  assert.equal(summary.records.length, 3);
  assert.equal(summary.missing.length, 3); assert.equal(summary.total, 900);
  assert.deepEqual(rentReceipts(s).months, ['2026-09']);
  assert.deepEqual(rentReceipts(s).values, [900]);
  assert.equal(buildRentLedger(s, '2026-10-10').people.r.outstanding, 1000);
  s.data.rents.b.periodStart = '2026-10-01';
  assert.equal(buildRentLedger(s, '2026-10-10').people.r.outstanding, 1000);
  s.data.residents.r.deleted = true;
  assert.deepEqual(rentRecordSummary(s).records, []);
});

test('房租可独立新增，校验重叠租期、金额和日期，不受自动计算边界限制', () => {
  const s = blankState(); s.settings.ledgerStart = '2026-10';
  s.data.residents.r = { id: 'r', name: 'A', moveIn: '2025-01-01' };
  const rec = { id: 'x', residentId: 'r', periodStart: '2026-09-16', periodEnd: '2026-10-15', dueDate: '2026-09-10', datesConfirmed: true, history: true, paid: true, receivedAmount: null, paidDate: null };
  assert.equal(validateRentRecord(s, rec), null);
  assert.equal(validateRentRecord(s, { ...rec, receivedAmount: 0, paidDate: '2026-09-05' }), null);
  assert.equal(validateRentRecord(s, { ...rec, receivedAmount: -1 }), 'amount');
  assert.equal(validateRentRecord(s, { ...rec, receivedAmount: Infinity }), 'amount');
  assert.equal(validateRentRecord(s, { ...rec, paidDate: '2026-02-30' }), 'date');
  assert.equal(validateRentRecord(s, { ...rec, periodStart: '2026-13-16' }), 'date');
  assert.equal(validateRentRecord(s, { ...rec, periodStart: '2026-10-01' }), null);
  s.data.rents.other = { ...rec, id: 'other', periodStart: '2026-09-01' };
  assert.equal(validateRentRecord(s, rec), 'overlap');
  assert.equal(validateRentRecord(s, s.data.rents.other), null);
  assert.equal(validateRentRecord(s, { ...rec, residentId: 'absent' }), 'tenant');
});
