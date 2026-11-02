// 统计模块测试（合成数据）
import test from 'node:test';
import assert from 'node:assert/strict';
import { monthShares, monthlyCosts, monthlyUsage, billStats, compareBill, billCategoryAmounts, addMonths, monthRange, periodSummary, billShares, billDays, rangeBill, explainChange, shiftYear } from '../src/core/analytics.js';

const P = { p_e: { id: 'p_e', category: 'energy' }, p_w: { id: 'p_w', category: 'water' }, p_n: { id: 'p_n', category: 'internet' } };
const bill = (o) => ({ id: o.id || Math.random().toString(36), providerId: 'p_e', items: [], usage: [], allocation: { mode: 'auto' }, ...o });

test('按天数摊到自然月', () => {
  const s = monthShares('2025-01-21', '2025-03-21');
  assert.deepEqual(s.map(x => x[0]), ['2025-01', '2025-02', '2025-03']);
  const days = 59;
  assert.ok(Math.abs(s[0][1] - 11 / days) < 1e-9);
  assert.ok(Math.abs(s[1][1] - 28 / days) < 1e-9);
  assert.ok(Math.abs(s[2][1] - 20 / days) < 1e-9);
  assert.deepEqual(monthShares('2025-02-01', '2025-03-01'), [['2025-02', 1]]);
  assert.deepEqual(monthShares(null, null, '2025-05-09'), [['2025-05', 1]]);
});

test('月份加减', () => {
  assert.equal(addMonths('2025-11', 3), '2026-02');
  assert.equal(addMonths('2025-01', -1), '2024-12');
  assert.equal(addMonths('2025-01', -12), '2024-01');
  assert.deepEqual(monthRange('2024-11', '2025-02'), ['2024-11', '2024-12', '2025-01', '2025-02']);
});

test('分项按类别拆开，差额记到默认类别', () => {
  const b = bill({ total: 100, items: [{ key: 'electric_delivery', amount: 50 }, { key: 'electric_generation', amount: 20 }, { key: 'gas', amount: 25 }] });
  assert.deepEqual(billCategoryAmounts(b, P.p_e), { electricity: 75, gas: 25 });
  const w = bill({ providerId: 'p_w', total: 90, items: [{ key: 'water', amount: 40 }, { key: 'sewer', amount: 30 }, { key: 'garbage', amount: 20 }] });
  assert.deepEqual(billCategoryAmounts(w, P.p_w), { water: 90 });
  const n = bill({ providerId: 'p_n', total: 60, items: [] });
  assert.deepEqual(billCategoryAmounts(n, P.p_n), { internet: 60 });
});

test('每月花费：两个月一张的水费摊开；没出账的月份标记不完整', () => {
  const bills = [
    bill({ providerId: 'p_e', periodStart: '2025-01-01', periodEnd: '2025-02-01', total: 31, items: [{ key: 'gas', amount: 31 }] }),
    bill({ providerId: 'p_e', periodStart: '2025-02-01', periodEnd: '2025-03-01', total: 28, items: [{ key: 'gas', amount: 28 }] }),
    bill({ providerId: 'p_w', periodStart: '2025-01-01', periodEnd: '2025-03-01', total: 59, items: [{ key: 'water', amount: 59 }] }),
    bill({ providerId: 'p_e', periodStart: '2025-03-01', periodEnd: '2025-04-01', total: 31, items: [{ key: 'gas', amount: 31 }] }),
  ];
  const m = monthlyCosts(bills, P);
  assert.deepEqual(m.months, ['2025-01', '2025-02', '2025-03']);
  assert.deepEqual(m.byCat.gas, [31, 28, 31]);
  assert.deepEqual(m.byCat.water, [31, 28, null]);
  assert.deepEqual(m.total, [62, 56, 31]);
  assert.deepEqual(m.complete, [true, true, false]);
  const s = periodSummary(m.months, m.total, m.complete, '2025-01', '2025-12');
  assert.deepEqual(s, { sum: 118, months: 2, avg: 59 });
});

test('每月用量、单价、每天花费', () => {
  const b = bill({ periodStart: '2025-01-15', periodEnd: '2025-02-14', total: 90, items: [{ key: 'electric_delivery', amount: 40 }, { key: 'electric_generation', amount: 20 }, { key: 'gas', amount: 30 }], usage: [{ key: 'electricity', amount: 300, unit: 'kWh' }, { key: 'gas', amount: 15, unit: 'therm' }] });
  const st = billStats(b);
  assert.equal(st.days, 30);
  assert.equal(st.perDay, 3);
  assert.equal(st.usage.electricity.perDay, 10);
  assert.equal(st.rates.electricity.value, 0.2);
  assert.equal(st.rates.gas.value, 2);
  const u = monthlyUsage([b]);
  assert.deepEqual(u.months, ['2025-01', '2025-02']);
  assert.deepEqual(u.byKey.electricity, [170, 130]);
  assert.equal(u.units.gas, 'therm');
});

test('和上一张、去年同期比较（按每天花费）', () => {
  const mk = (s, e, total, id) => bill({ id, periodStart: s, periodEnd: e, total });
  const list = [mk('2024-01-10', '2024-02-09', 60, 'a'), mk('2024-12-10', '2025-01-09', 90, 'b'), mk('2025-01-09', '2025-02-10', 96, 'c')];
  const r = compareBill(list[2], list);
  assert.equal(r.prev.bill.id, 'b');
  assert.ok(Math.abs(r.prev.perDayChange - 0) < 1e-9);   // 3/天 vs 3/天
  assert.ok(r.lastYear.bill.pseudo);                        // 去年同一段日期，按天摊出来
  assert.equal(r.lastYear.bill.sources[0].id, 'a');
  assert.ok(Math.abs(r.lastYear.perDayChange - 0.5) < 1e-9);  // 3/天 vs 2/天
  assert.equal(compareBill(list[0], list).prev, null);
});

test('分摊：锁定的用存下来的，自动的现算', () => {
  const res = [{ id: 'a', moveIn: '2020-01-01', moveOut: null, weights: [], isOwner: true }, { id: 'b', moveIn: '2025-01-16', moveOut: null, weights: [] }];
  const b = bill({ periodStart: '2025-01-01', periodEnd: '2025-01-31', total: 45 });
  const auto = billShares(b, P.p_e, res);
  assert.equal(auto.mode, 'auto');
  assert.deepEqual(auto.shares, { a: 30, b: 15 });
  const locked = billShares({ ...b, allocation: { mode: 'locked', shares: { a: 45 } } }, P.p_e, res);
  assert.deepEqual(locked.shares, { a: 45 });
});

test('含结束日的账单多算一天', () => {
  assert.equal(billDays({ periodStart: '2031-01-31', periodEnd: '2031-03-02', endInclusive: true }), 31);
  assert.equal(billDays({ periodStart: '2031-01-31', periodEnd: '2031-03-02' }), 30);
  assert.equal(shiftYear('2028-02-29', -1), '2027-02-28');
});

test('一段日期的虚拟账单：跨两张账单按天摊，覆盖不够时不算', () => {
  const bills = [
    bill({ id: 'x', periodStart: '2024-01-01', periodEnd: '2024-01-31', total: 30, usage: [{ key: 'gas', amount: 30, unit: 'therm' }] }),
    bill({ id: 'y', periodStart: '2024-01-31', periodEnd: '2024-03-01', total: 60, usage: [{ key: 'gas', amount: 60, unit: 'therm' }] }),
  ];
  const r = rangeBill(bills, '2024-01-21', '2024-02-10');   // 10 天在 x（1/天），10 天在 y（2/天）
  assert.equal(r.total, 30);
  assert.equal(r.usage[0].amount, 30);
  assert.equal(rangeBill(bills, '2023-12-01', '2024-01-05'), null);
});

test('变化拆解：人数、人均用量、单价', () => {
  const res = [{ id: 'o', moveIn: '2020-01-01', weights: [], isOwner: true }, { id: 'a', moveIn: '2025-01-01', weights: [] }];
  const now = bill({ periodStart: '2025-01-01', periodEnd: '2025-01-31', total: 132, items: [{ key: 'gas', amount: 132 }], usage: [{ key: 'gas', amount: 60, unit: 'therm' }] });
  const before = bill({ periodStart: '2024-01-01', periodEnd: '2024-01-31', total: 50, items: [{ key: 'gas', amount: 50 }], usage: [{ key: 'gas', amount: 25, unit: 'therm' }] });
  const x = explainChange(now, before, res).gas;
  assert.ok(Math.abs(x.heads - 1) < 1e-9);          // 1 人 → 2 人
  assert.ok(Math.abs(x.perCapita - 0.2) < 1e-9);    // 每人每天 25/30 → 30/30
  assert.ok(Math.abs(x.price - 0.1) < 1e-9);        // $2.00 → $2.20
  assert.ok(Math.abs((1 + x.heads) * (1 + x.perCapita) * (1 + x.price) * (1 + x.days) - (1 + x.cost)) < 1e-9);
});
