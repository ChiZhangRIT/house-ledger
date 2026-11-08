import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateRentPeriod, rentPeriodsFor } from '../src/core/rent.js';
import { blankState, normalizeState } from '../src/core/store.js';

const resident = () => ({ moveIn: '2022-10-01', moveOut: '2023-02-07',
  rent: [{ from: '2022-10-01', amount: 1700 }],
  rentSchedules: [{ from: '2022-10-01', cycleDay: 16, dueDay: 15, dueMonthOffset: 0 }] });

test('1/16至2/7含结束日为23天，按完整16日至次月15日的31天折算', () => {
  const result = calculateRentPeriod(resident(), '2023-01-16', '2023-02-07');
  assert.equal(result.amount, 1261.29);
  assert.deepEqual(result.parts.map(p => [p.cycleStart, p.cycleEnd, p.days, p.periodDays]),
    [['2023-01-16', '2023-02-15', 23, 31]]);
  assert.equal(calculateRentPeriod(resident(), '2023-01-16', '2023-02-15').amount, 1700);
});

test('入住首期用约定的完整周期作分母，不受待收起点或搬出日期截短', () => {
  const r = { ...resident(), rentTrackingStart: '2026-11-01' };
  const result = calculateRentPeriod(r, '2022-10-01', '2022-10-15');
  assert.equal(result.amount, 850);
  assert.deepEqual([result.parts[0].cycleStart, result.parts[0].cycleEnd, result.parts[0].periodDays],
    ['2022-09-16', '2022-10-15', 30]);
});

test('短月、闰年及31号起算沿用实际周期天数，跨多个周期分别计算', () => {
  assert.equal(calculateRentPeriod(resident(), '2023-02-16', '2023-03-07').amount, 1214.29);
  assert.equal(calculateRentPeriod(resident(), '2024-02-16', '2024-03-07').amount, 1231.03);
  const r = resident(); r.rentSchedules[0].cycleDay = 31;
  const result = calculateRentPeriod(r, '2024-02-29', '2024-03-07');
  assert.deepEqual([result.amount, result.parts[0].periodDays, result.parts[0].days], [438.71, 31, 8]);
  assert.equal(calculateRentPeriod(resident(), '2023-01-16', '2023-03-07').amount, 2914.29);
});

test('月租或租期变更按生效日期分段，不用当前月租反推过去金额', () => {
  const r = resident(); r.rent.push({ from: '2023-02-01', amount: 1800 });
  const result = calculateRentPeriod(r, '2023-01-16', '2023-02-07');
  assert.equal(result.amount, 1283.87);
  assert.deepEqual(result.parts[0].rates.map(x => [x.amount, x.days]), [[1700, 16], [1800, 7]]);
  r.rentSchedules.push({ from: '2023-02-01', cycleDay: 1, dueDay: 1, dueMonthOffset: 0 });
  assert.equal(calculateRentPeriod(r, '2023-01-16', '2023-02-07').amount, 1327.42);
});

test('日期、适用约定或月租缺失时不猜金额；零月租有效，已有收整期设置保留', () => {
  assert.equal(calculateRentPeriod(resident(), '', '2023-02-07').reason, 'dates');
  assert.equal(calculateRentPeriod(resident(), '2023-02-08', '2023-02-07').reason, 'dates');
  assert.equal(calculateRentPeriod(resident(), '2022-09-01', '2022-09-15').reason, 'schedule');
  const r = resident(); r.rent = [{ from: '2023-02-01', amount: 1700 }];
  assert.equal(calculateRentPeriod(r, '2023-01-16', '2023-02-07').reason, 'rent');
  r.rent = [{ from: '2022-10-01', amount: 0 }];
  assert.equal(calculateRentPeriod(r, '2023-01-16', '2023-02-07').amount, 0);
  assert.equal(calculateRentPeriod(resident(), '2023-01-16', '2023-02-07', 'full').amount, 1700);
});

test('自动与手动方式随备份保留，改变月租不会在读取台账时改写已保存金额', () => {
  const s = blankState(); s.data.residents.r = { ...resident(), id: 'r', name: 'Test', rentTrackingStart: null };
  for (const [id, amountAuto, periodStart, periodEnd] of [['auto', true, '2023-01-16', '2023-02-07'], ['manual', false, '2022-12-16', '2023-01-15']]) {
    s.data.rents[id] = { id, residentId: 'r', history: false, datesConfirmed: true,
      periodStart, periodEnd, dueDate: periodStart, amount: 999, amountAuto };
  }
  const backup = normalizeState(JSON.parse(JSON.stringify(s)));
  assert.equal(backup.data.rents.auto.amountAuto, true);
  assert.equal(backup.data.rents.manual.amountAuto, false);
  backup.data.residents.r.rent[0].amount = 2000;
  assert.deepEqual(rentPeriodsFor(backup, 'r', '2023-03-01').map(x => x.amount), [999, 999]);
  assert.equal(calculateRentPeriod(backup.data.residents.r, '2023-01-16', '2023-02-07').amount, 1483.87);
});
