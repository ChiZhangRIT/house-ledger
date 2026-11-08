import test from 'node:test';
import assert from 'node:assert/strict';
import { blankState, normalizeState, deletedRecord, restoredRecord, canon, mergeStates } from '../src/core/store.js';
import { rentPeriodsFor, buildRentLedger, rentReceipts, rentRecordSummary } from '../src/core/rent.js';
import { scheduledPeriods, validateRentPeriod } from '../src/core/rentPeriods.js';

function fixture() {
  const s = blankState();
  s.data.residents.r = { id: 'r', name: 'Test', moveIn: '2022-10-01', moveOut: '2023-02-07',
    rentTrackingStart: '2022-10-01', rent: [{ from: '2022-10-01', amount: 1700 }],
    rentSchedules: [{ from: '2022-10-01', cycleDay: 16, dueDay: 15, dueMonthOffset: 0 }] };
  return s;
}

test('导入和手记房租在同一列表，收款与调整可关联两者，不重复统计', () => {
  const s = fixture();
  s.data.rents.imported = { id: 'imported', residentId: 'r', history: true, datesConfirmed: true,
    periodStart: '2022-10-01', periodEnd: '2022-10-15', dueDate: '2022-09-15',
    paid: true, receivedAmount: 1700, paidDate: '2022-09-15', amount: 9999, note: '保留备注' };
  // 编辑时明确填写应收，不把旧 amount 或实收金额猜作应收。
  assert.equal(rentPeriodsFor(s, 'r', '2023-03-01').find(x => x.id === 'imported').amount, null);
  s.data.rents.imported = { ...s.data.rents.imported, history: false, amount: 1700 };
  const manual = rentPeriodsFor(s, 'r', '2023-03-01').find(x => x.periodStart === '2022-10-16');
  s.data.rents[manual.id] = manual;
  s.data.payments.p = { id: 'p', purpose: 'rent', residentId: 'r', rentId: manual.id, amount: 1700, date: '2022-10-15' };
  s.data.adjustments.a = { id: 'a', purpose: 'rent', residentId: 'r', rentId: 'imported', amount: -200, collectPeriod: '2022-10' };
  s.data.payments.refund = { id: 'refund', purpose: 'rent', residentId: 'r', rentId: 'imported', amount: -200, date: '2022-10-01' };
  const p = buildRentLedger(s, '2023-03-01').people.r;
  assert.equal(p.debits.find(x => x.rentId === 'imported').remaining, 0);
  assert.equal(p.debits.find(x => x.rentId === manual.id).remaining, 0);
  assert.equal(p.unassignedAdjustments.length, 0);
  assert.equal(p.unassignedPayments.length, 0);
  assert.equal(rentRecordSummary(s, 'r').records.length, 2);
  assert.deepEqual(rentReceipts(s).values, [1700, 1500]);
});

test('租期可在待收起点前后编辑；未知日期不捏造，手记租期覆盖自动候选', () => {
  const s = fixture();
  const rec = { id: 'manual', residentId: 'r', history: false, datesConfirmed: true,
    periodStart: '2022-09-04', periodEnd: '2022-10-15', dueDate: '2022-09-15', amount: null };
  assert.equal(validateRentPeriod(s, rec), null);
  assert.equal(validateRentPeriod(s, { ...rec, periodStart: '2022-10-01' }), null);
  const partial = { ...rec, periodStart: null, periodEnd: null, dueDate: null, paidDate: '2022-09-15' };
  assert.equal(validateRentPeriod(s, partial), null);
  const backup = structuredClone(s); backup.data.rents.partial = { ...partial, id: 'partial' };
  assert.equal(normalizeState(backup).data.rents.partial.periodStart, null);
  assert.equal(validateRentPeriod(s, { ...rec, periodStart: null, periodEnd: null, dueDate: null }), 'required');
  s.data.rents.manual = rec;
  assert.equal(scheduledPeriods(s, s.data.residents.r, '2023-03-01').some(x => x.periodStart === '2022-10-01'), false);
});

test('未知应收不因导入或付款勾选变成欠款；未知到账日仍抵本期但不猜收入月份', () => {
  const s = fixture(); s.data.residents.r.rentTrackingStart = null;
  s.data.rents.old = { id: 'old', residentId: 'r', legacyDate: '2022-10-16', paid: true, amount: 9999, receivedAmount: null };
  assert.equal(buildRentLedger(s, '2023-03-01').people.r.outstanding, 0);
  assert.equal(buildRentLedger(s, '2023-03-01').people.r.unknownRent.length, 1);
  s.data.rents.old = { ...s.data.rents.old, history: false, datesConfirmed: true, amount: 1700, receivedAmount: 1700,
    periodStart: '2022-10-16', periodEnd: '2022-11-15', dueDate: '2022-10-15' };
  assert.equal(buildRentLedger(s, '2023-03-01').people.r.outstanding, 0);
  assert.deepEqual(rentReceipts(s).months, []);
  assert.equal(rentRecordSummary(s, 'r').missing.length, 1);
});

test('删除自动或手记租期后不重生，可经备份同步恢复，同 id 批注保留', () => {
  const s = fixture(), first = rentPeriodsFor(s, 'r', '2023-03-01')[0];
  s.data.rents[first.id] = deletedRecord(first, 20);
  assert.equal(rentPeriodsFor(s, 'r', '2023-03-01').some(x => x.id === first.id), false);
  const manual = { ...first, id: 'manual', updatedAt: 10 };
  s.data.rents.manual = deletedRecord(manual, 20);
  s.data.comments.note = { id: 'note', target: { collection: 'rents', id: 'manual' }, comments: [{ text: '原备注' }] };
  const reloaded = normalizeState(JSON.parse(JSON.stringify(s)));
  assert.equal(rentPeriodsFor(reloaded, 'r', '2023-03-01').some(x => x.periodStart === first.periodStart), false);
  reloaded.data.rents.manual = restoredRecord('rents', reloaded.data.rents.manual, null, 30);
  assert.equal(rentPeriodsFor(reloaded, 'r', '2023-03-01').filter(x => x.periodStart === first.periodStart).length, 1);
  assert.equal(reloaded.data.comments.note.target.id, 'manual');
});

test('统一读取不改写原始金额、付款和备注；备份同步后内含收款只统计一次', () => {
  const s = fixture(); s.data.residents.r.rentTrackingStart = null;
  s.data.rents.old = { id: 'old', residentId: 'r', history: true, legacyDate: '2022-10-16',
    amount: 9999, paid: true, receivedAmount: 1700, paidDate: '2022-10-15', note: '原始备注', updatedAt: 10 };
  const before = canon(s);
  for (let n = 0; n < 3; n++) {
    buildRentLedger(s, '2023-03-01'); rentPeriodsFor(s, 'r', '2023-03-01'); rentReceipts(s); rentRecordSummary(s);
  }
  assert.equal(canon(s), before);
  const synced = mergeStates(normalizeState(JSON.parse(JSON.stringify(s))), s);
  assert.deepEqual(rentReceipts(synced).values, [1700]);
  assert.equal(synced.data.rents.old.amount, 9999);
  assert.deepEqual(synced.data.payments, {});
});

test('删除租期保留单独收款与调整，恢复后重新对应原记录，不丢钱或重复收款', () => {
  const s = fixture(); s.data.residents.r.rentTrackingStart = null;
  const rec = { id: 'record', residentId: 'r', history: false, datesConfirmed: true,
    periodStart: '2022-10-01', periodEnd: '2022-10-15', dueDate: '2022-09-15', amount: 1700,
    paid: true, receivedAmount: 1700, paidDate: '2022-09-15' };
  s.data.rents.record = rec;
  s.data.payments.refund = { id: 'refund', residentId: 'r', purpose: 'rent', rentId: 'record', amount: -200, date: '2022-10-01' };
  s.data.adjustments.discount = { id: 'discount', residentId: 'r', purpose: 'rent', rentId: 'record', amount: -200, collectPeriod: '2022-10' };
  s.data.rents.record = deletedRecord(rec, 20);
  assert.equal(buildRentLedger(s, '2023-03-01').people.r.unassignedPayments.length, 1);
  assert.equal(buildRentLedger(s, '2023-03-01').people.r.unassignedAdjustments.length, 1);
  assert.deepEqual(rentReceipts(s).values, [-200]);
  s.data.rents.record = restoredRecord('rents', s.data.rents.record, null, 30);
  const p = buildRentLedger(s, '2023-03-01').people.r;
  assert.equal(p.unassignedPayments.length, 0);
  assert.equal(p.unassignedAdjustments.length, 0);
  assert.equal(p.outstanding, 0);
  assert.deepEqual(rentReceipts(s).values, [1700, -200]);
});
