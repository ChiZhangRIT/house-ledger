import test from 'node:test';
import assert from 'node:assert/strict';
import { utilityRows, utilityYearComparison } from '../src/core/utilities.js';
import { parse } from '../src/pdf/parsers/sunnyvale.js';

test('各 Utility 只使用自身分项与单位；网络公司切换保留连续历史', () => {
  const providers = { p: { category: 'energy' }, x: { category: 'internet' }, a: { category: 'internet' } };
  const bill = { id: 'b', providerId: 'p', statementDate: '2026-10-08', periodStart: '2026-09-01', periodEnd: '2026-09-30', endInclusive: true,
    total: 130, items: [{ key: 'electric_delivery', amount: 80 }, { key: 'electric_generation', amount: 30 }, { key: 'gas', amount: 20 }], usage: [{ key: 'electricity', amount: 300, unit: 'kWh' }, { key: 'gas', amount: 8, unit: 'therm' }] };
  const electricity = utilityRows([bill], providers, 'electricity')[0];
  assert.equal(electricity.amount, 110); assert.equal(electricity.usage, 300); assert.equal(electricity.days, 30);
  assert.equal(utilityRows([bill], providers, 'gas')[0].amount, 20);
  assert.equal(utilityRows([{ ...bill, items: [] }], providers, 'gas')[0].amount, null);
  const internet = utilityRows([{ ...bill, providerId: 'x', total: -4 }, { ...bill, id: 'c', providerId: 'a', total: 65 }], providers, 'internet');
  assert.deepEqual(internet.map(x => x.amount), [-4, 65]);
});

test('市政分项各用自己的服务期；缺失污水周期时不套用水表周期', () => {
  const lines = ['CITY OF SUNNYVALE', 'UTILITY ACCOUNT SUMMARY FOR 000000-00000', 'Bill Date: 10/22/2026', 'Current Charges  300.00', 'ACCOUNT DETAIL',
    'WATER SERVICE  SERVICE PERIOD', 'Domestic Meter #0  08/20/26 10/14/26  55  100.00 112.00', 'Total Water Service  12.00 CCF  $100.00',
    'SEWER SERVICE  SERVICE PERIOD', 'Single-Family Sewer  08/15/26 10/19/26  120.00', 'Total Sewer Service  $120.00',
    'GARBAGE SERVICE  SERVICE PERIOD', '43-Gal Cart Curb  08/15/26 10/19/26  80.00', 'Total Garbage Service  $80.00', 'Total Current Charges  $300.00'];
  const draft = parse(lines, lines.join('\n'));
  assert.deepEqual(draft.servicePeriods.sewer, { periodStart: '2026-08-15', periodEnd: '2026-10-19' });
  const b = { ...draft, id: 'b', providerId: 'p', itemPeriods: draft.servicePeriods };
  const providers = { p: { category: 'water' } };
  assert.equal(utilityRows([b], providers, 'water')[0].days, 55);
  assert.equal(utilityRows([b], providers, 'garbage')[0].days, 65);
  delete b.itemPeriods;
  assert.equal(utilityRows([b], providers, 'sewer')[0].start, null);
  assert.equal(utilityRows([b], providers, 'sewer', { b: { items: draft.servicePeriods } })[0].days, 65);
});

test('账单费用堆叠保留抵扣和重复分项，未分项差额单列，净额等于账单', async () => {
  const { billCostSeries } = await import('../src/core/utilities.js');
  const series = billCostSeries([
    { total: 100, items: [{ key: 'internet', amount: 110 }, { key: 'internet', amount: 5 }, { key: 'discount', amount: -20 }] },
    { total: -4, items: [{ key: 'discount', amount: -4 }] },
  ]);
  assert.deepEqual(series.find(s => s.key === 'internet').values, [115, null]);
  assert.deepEqual(series.find(s => s.key === 'discount').values, [-20, -4]);
  assert.deepEqual(series.find(s => s.key === 'unallocated').values, [5, null]);
  assert.deepEqual([0, 1].map(i => series.reduce((n, s) => n + (s.values[i] || 0), 0)), [100, -4]);
});

const electric = (id, start, end, amount, usage) => ({ id, providerId: 'p', statementDate: end, periodStart: start, periodEnd: end, endInclusive: true,
  total: amount, items: [{ key: 'electric_delivery', amount }], usage: [{ key: 'electricity', amount: usage, unit: 'kWh' }] });
const rowsOf = bills => utilityRows(bills, { p: { category: 'energy' } }, 'electricity');
const yearlyBills = () => [electric('a', '2025-08-15', '2025-09-14', 31, 310), electric('b', '2025-09-15', '2025-10-14', 90, 600), electric('now', '2026-09-01', '2026-09-30', 180, 600)];

test('同比按同一服务日期跨账单折算，而非按出账月份或整张账单匹配', () => {
  const rows = rowsOf(yearlyBills()), ref = utilityYearComparison(rows.at(-1), rows);
  assert.equal(ref.start, '2025-09-01'); assert.equal(ref.end, '2025-09-30'); assert.equal(ref.days, 30);
  assert.ok(Math.abs(ref.perDay - (14 + 16 * 3) / 30) < 1e-10);
  assert.ok(Math.abs(ref.usagePerDay - (140 + 320) / 30) < 1e-10);
  assert.ok(Math.abs(ref.costChange - (180 / 62 - 1)) < 1e-10);
});

test('同比拒绝历史缺口、重复和重叠，不补齐缺失天数', () => {
  for (const start of ['2025-09-16', '2025-09-14']) {
    const bills = yearlyBills(); bills[1].periodStart = start;
    const rows = rowsOf(bills);
    assert.equal(utilityYearComparison(rows.at(-1), rows), null);
  }
  const bills = yearlyBills(); bills.push({ ...bills[0], id: 'duplicate' });
  const rows = rowsOf(bills);
  assert.equal(utilityYearComparison(rows.at(-1), rows), null);
});

test('同比独立保留用量或金额缺失，不将缺失值当零', () => {
  for (const missing of ['usage', 'items']) {
    const bills = yearlyBills(); bills[1][missing] = [];
    const rows = rowsOf(bills), ref = utilityYearComparison(rows.at(-1), rows);
    assert.equal(ref[missing === 'usage' ? 'usagePerDay' : 'perDay'], null);
    assert.equal(ref[missing === 'usage' ? 'usageChange' : 'costChange'], null);
    assert.ok(ref[missing === 'usage' ? 'perDay' : 'usagePerDay'] > 0);
  }
});

test('闰年按各自计费天数计算；去年同期为零不计算百分比', () => {
  const rows = rowsOf([electric('prior', '2023-02-01', '2023-02-28', 0, 280), electric('now', '2024-02-01', '2024-02-29', 29, 290)]);
  const ref = utilityYearComparison(rows.at(-1), rows);
  assert.equal(rows.at(-1).days, 29); assert.equal(ref.days, 28);
  assert.equal(ref.usagePerDay, 10); assert.equal(ref.usageChange, 0);
  assert.equal(ref.perDay, 0); assert.equal(ref.costChange, null);
});
