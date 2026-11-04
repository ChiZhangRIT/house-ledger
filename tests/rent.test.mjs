import test from 'node:test';
import assert from 'node:assert/strict';
import { blankState } from '../src/core/store.js';
import { buildRentLedger, rentReceipts } from '../src/core/rent.js';

test('房租应收、收款和统计不包含 Utility 或未分类旧收款', () => {
  const s = blankState(); s.settings = { ledgerStart: '2026-10', rentCycleDay: 1 };
  s.data.residents.r = { id: 'r', moveIn: '2026-10-01', rent: [{ from: '2026-10-01', amount: 1000 }] };
  s.data.bills.b = { id: 'b', total: 99, collectPeriod: '2026-10', allocation: { mode: 'locked', shares: { r: 99 } } };
  s.data.payments.a = { id: 'a', residentId: 'r', date: '2026-10-03', amount: 400, purpose: 'rent' };
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
