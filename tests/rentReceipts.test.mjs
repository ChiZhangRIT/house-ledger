import test from 'node:test';
import assert from 'node:assert/strict';
import { blankState, canon } from '../src/core/store.js';
import { rentReceipts, rentReceiptYear } from '../src/core/rent.js';

function fixture() {
  const s = blankState();
  s.data.residents.r = { id: 'r', name: 'Example', moveIn: '2024-01-01' };
  const pay = (id, amount, date, extra = {}) => s.data.payments[id] = { id, residentId: 'r', purpose: 'rent', amount, date, ...extra };
  return { s, pay };
}

test('月份清单固定十二个月，按到账日期统计房租分配，押金不混入收入', () => {
  const { s, pay } = fixture();
  pay('shared', 5100, '2025-03-03', { purpose: 'housing', allocations: [
    { purpose: 'rent', rentId: 'january', amount: 1700 },
    { purpose: 'rent', rentId: 'february', amount: 1700 },
    { purpose: 'deposit', amount: 1700 },
  ] });
  pay('deposit-return', -1700, '2025-10-24', { purpose: 'deposit' });
  pay('previous', 1700, '2024-12-31');
  const before = canon(s), receipts = rentReceipts(s), year = rentReceiptYear(receipts, 2025);
  assert.equal(year.months.length, 12);
  assert.deepEqual(year.months.map(m => m.key), Array.from({ length: 12 }, (_, i) => '2025-' + String(i + 1).padStart(2, '0')));
  assert.equal(year.net, 3400);
  assert.deepEqual(year.months.map(m => m.net), [0, 0, 3400, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(year.months[2].payments.length, 2);
  assert.equal(rentReceiptYear(receipts, 2024).net, 1700);
  assert.equal(canon(s), before);
});

test('零收入区分无记录与收退相抵，净退款单独保留，合计按分计算', () => {
  const { s, pay } = fixture();
  pay('receipt', 1700, '2025-08-01'); pay('refund', -1700, '2025-08-28');
  pay('net-refund', -600, '2025-10-24');
  pay('one', .1, '2025-03-01'); pay('two', .2, '2025-03-02'); pay('three', -.3, '2025-03-03');
  const year = rentReceiptYear(rentReceipts(s), 2025);
  assert.equal(year.net, -600);
  assert.deepEqual([year.months[0].net, year.months[0].payments.length], [0, 0]);
  assert.deepEqual([year.months[7].net, year.months[7].received, year.months[7].refunded, year.months[7].payments.length], [0, 1700, 1700, 2]);
  assert.equal(year.months[2].net, 0);
  assert.deepEqual([year.months[9].net, year.months[9].refunded], [-600, 600]);
});

test('金额未知不当作零，日期无法查证不强归月份，已删除记录及房东不计入', () => {
  const { s, pay } = fixture();
  pay('undated', 850, '', { dateUnavailable: true });
  pay('unknown-both', null, '', { confirmationOnly: true });
  pay('unknown-amount', null, '2025-04-15', { confirmationOnly: true });
  pay('known', 1700, '2025-04-15');
  pay('deleted', 1700, '2025-04-15', { deleted: true });
  s.data.residents.owner = { id: 'owner', isOwner: true };
  pay('owner', 9999, '2025-04-15', { residentId: 'owner' });
  pay('utility', 9999, '2025-04-15', { purpose: 'utility' });
  const receipts = rentReceipts(s), year = rentReceiptYear(receipts, 2025);
  assert.deepEqual(receipts.undated.map(p => p.id), ['undated', 'unknown-both']);
  assert.deepEqual(receipts.unknownAmounts.map(p => p.id), ['unknown-amount']);
  assert.equal(year.net, 1700);
  assert.equal(year.months[3].incomplete, true);
  assert.deepEqual(year.months[3].payments.map(p => p.id), ['known', 'unknown-amount']);
  assert.equal(rentReceiptYear(receipts, 2026).net, 0);
});
