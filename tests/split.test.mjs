import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allocate, personDays, splitCents, weightOn } from '../src/core/split.js';
import { daysBetween, overlapDays, isISODate, addDays } from '../src/core/dates.js';

const R = (id, moveIn, moveOut = null, extra = {}) => ({ id, moveIn, moveOut, ...extra });

test('dates use half-open intervals like the spreadsheet DATEDIF', () => {
  assert.equal(daysBetween('2024-01-01', '2024-02-01'), 31);
  assert.equal(overlapDays('2024-01-10', '2024-01-20', '2024-01-15', '2024-02-01'), 5);
  assert.equal(addDays('2024-02-28', 2), '2024-03-01');
  assert.ok(isISODate('2024-02-29') && !isISODate('2023-02-29'));
});

test('full-period residents split evenly, partial residents by days present', () => {
  const bill = { periodStart: '2024-01-01', periodEnd: '2024-01-31', total: 300 };
  const res = [R('a', '2023-01-01'), R('b', '2023-06-01'), R('c', '2024-01-16')];
  const { shares, periodDays } = allocate(bill, res, 'energy');
  assert.equal(periodDays, 30);
  // a=30, b=30, c=15 人·天 → 120 / 120 / 60
  assert.deepEqual(shares, { a: 120, b: 120, c: 60 });
});

test('move-out day is not counted, move-in day is', () => {
  assert.equal(personDays(R('x', '2024-01-10', '2024-01-20'), '2024-01-01', '2024-02-01'), 10);
});

test('weights: a couple counts double, and weight changes mid-period are split by day', () => {
  const couple = R('c', '2023-01-01', null, { weights: [{ from: '2023-01-01', weight: 2 }] });
  const me = R('me', '2022-06-22', null, { weights: [{ from: '2024-01-16', weight: 2 }] });
  assert.equal(weightOn(me, '2024-01-15'), 1);
  assert.equal(weightOn(me, '2024-01-16'), 2);
  assert.equal(personDays(me, '2024-01-01', '2024-01-31'), 15 * 1 + 15 * 2);
  const { shares } = allocate({ periodStart: '2024-01-01', periodEnd: '2024-01-31', total: 105 }, [couple, me], 'water');
  // c = 60 人·天，me = 45 人·天
  assert.deepEqual(shares, { c: 60, me: 45 });
});

test('residents who do not share a category are left out', () => {
  const res = [R('a', '2023-01-01', null, { isOwner: true }), R('b', '2023-01-01', null, { utilities: { energy: false } })];
  assert.deepEqual(allocate({ periodStart: '2024-01-01', periodEnd: '2024-02-01', total: 50 }, res, 'energy').shares, { a: 50 });
  assert.deepEqual(allocate({ periodStart: '2024-01-01', periodEnd: '2024-02-01', total: 50 }, res, 'internet').shares, { a: 25, b: 25 });
});

test('cents always add up to the bill total', () => {
  for (const total of [100, 99.99, 0.01, 1234.57, 41.47]) {
    const s = splitCents(total, [['a', 1], ['b', 1], ['c', 1]]);
    assert.equal(Math.round(Object.values(s).reduce((x, y) => x + y, 0) * 100), Math.round(total * 100), String(total));
  }
  assert.deepEqual(splitCents(100, [['a', 1], ['b', 1], ['c', 1]]), { a: 33.34, b: 33.33, c: 33.33 });
  assert.deepEqual(splitCents(-30, [['a', 1], ['b', 2]]), { a: -10, b: -20 });
});

test('nobody living there during the period: the whole bill goes to the owner', () => {
  const res = [R('owner', '2025-01-01', null, { isOwner: true, utilities: { energy: false } }), R('b', '2020-01-01', '2021-01-01')];
  const r = allocate({ periodStart: '2024-01-01', periodEnd: '2024-02-01', total: 80 }, res, 'energy');
  assert.equal(r.fallback, true);
  assert.deepEqual(r.shares, { owner: 80 });
});

test('参与方式「我承担」：照常计人·天，份额记到主租客名下', async () => {
  const { allocate, participation } = await import('../src/core/split.js');
  const res = [
    { id: 'o', moveIn: '2020-01-01', moveOut: null, weights: [], isOwner: true },
    { id: 'a', moveIn: '2020-01-01', moveOut: null, weights: [] },
    { id: 'b', moveIn: '2020-01-01', moveOut: null, weights: [], utilities: { energy: 'owner' } },
    { id: 'c', moveIn: '2020-01-01', moveOut: null, weights: [], utilities: { energy: false } },
  ];
  assert.equal(participation(res[2], 'energy'), 'owner');
  assert.equal(participation(res[3], 'energy'), 'excluded');
  assert.equal(participation(res[3], 'water'), 'share');
  const r = allocate({ periodStart: '2025-01-01', periodEnd: '2025-01-31', total: 90 }, res, 'energy');
  assert.deepEqual(r.shares, { o: 60, a: 30 });          // b 的 30 记给 o；c 不参与
  assert.equal(r.basis.find(x => x.id === 'b').absorbed, 30);
});

test('零头相同时按 id 分，和住户的排列顺序无关', () => {
  const a = splitCents(100.01, [['y', 1], ['x', 1], ['o', 1]]);
  const b = splitCents(100.01, [['o', 1], ['x', 1], ['y', 1]]);
  assert.deepEqual(a, b);
  assert.equal(a.o, 33.34);          // 'o' < 'x' < 'y'
});
