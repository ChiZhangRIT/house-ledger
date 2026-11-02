// 收款账测试（合成数据）
import test from 'node:test';
import assert from 'node:assert/strict';
import { blankState } from '../src/core/store.js';
import { periodOf, defaultCollectPeriod, rentCharge, receivables, settle, buildLedger, periodStart } from '../src/core/ledger.js';

function fixture() {
  const s = blankState();
  s.data.providers.p_e = { id: 'p_e', category: 'energy', updatedAt: 1 };
  s.data.residents.o = { id: 'o', name: 'Owner', moveIn: '2020-01-01', moveOut: null, isOwner: true, weights: [], updatedAt: 1 };
  s.data.residents.a = { id: 'a', name: 'Alice', moveIn: '2025-01-16', moveOut: null, weights: [], rent: [{ from: '2025-01-16', amount: 1000 }], updatedAt: 1 };
  s.data.residents.b = { id: 'b', name: 'Bob', moveIn: '2024-06-16', moveOut: '2025-03-01', weights: [], rent: [{ from: '2024-06-16', amount: 900 }], updatedAt: 1 };
  s.settings.rentCycleDay = 16;
  s.settings.ledgerStart = '2025-01';
  s.settings.graceDays = 3;
  return s;
}

test('收款期', () => {
  assert.equal(periodOf('2025-03-15', 16), '2025-02');
  assert.equal(periodOf('2025-03-16', 16), '2025-03');
  assert.equal(periodOf('2025-01-02', 16), '2024-12');
  assert.equal(defaultCollectPeriod('2025-03-08', '2025-03-10', 16), '2025-03');   // 跟 3/16 的房租一起收
  assert.equal(defaultCollectPeriod('2025-03-08', '2025-03-20', 16), '2025-04');   // 3/20 才录入：下一期
  assert.equal(defaultCollectPeriod('2025-03-16', '2025-03-16', 16), '2025-03');
});

test('房租：整期、按天折算、月租期中调整', () => {
  const s = fixture();
  assert.deepEqual(rentCharge(s.data.residents.a, '2025-02', 16), { cents: 100000, days: 28, periodDays: 28, prorated: false, unknown: false });
  const bob = rentCharge(s.data.residents.b, '2025-02', 16);              // 2/16–3/1 住了 13 天（共 28 天）
  assert.equal(bob.cents, Math.round(90000 * 13 / 28));
  assert.equal(bob.prorated, true);
  assert.equal(rentCharge(s.data.residents.b, '2025-03', 16), null);       // 搬走了
  assert.equal(rentCharge(s.data.residents.b, '2025-02', 16, 'full').cents, 90000);
  const c = { id: 'c', moveIn: '2025-01-16', rent: [{ from: '2025-01-16', amount: 1000 }, { from: '2025-01-31', amount: 1310 }] };
  assert.equal(rentCharge(c, '2025-01', 16).cents, Math.round((100000 * 15 + 131000 * 16) / 31));
  assert.equal(rentCharge({ id: 'd', moveIn: '2025-01-16', rent: [] }, '2025-01', 16).unknown, true);
});

test('应收项：开账期之前不算；账单份额计入 collectPeriod；没设 collectPeriod 的不算', () => {
  const s = fixture();
  s.data.bills.x = { id: 'x', providerId: 'p_e', statementDate: '2025-02-05', periodStart: '2025-01-01', periodEnd: '2025-02-01', total: 62, allocation: { mode: 'auto' }, collectPeriod: '2025-02', updatedAt: 1 };
  s.data.bills.old = { id: 'old', providerId: 'p_e', statementDate: '2024-12-05', periodStart: '2024-11-01', periodEnd: '2024-12-01', total: 50, allocation: { mode: 'locked', shares: { o: 25, b: 25 } }, collectPeriod: null, updatedAt: 1 };
  const r = receivables(s, '2025-02-20');
  assert.deepEqual(r.a.map(x => x.ref), ['rent:a:2025-01', 'rent:a:2025-02', 'bill:x:a']);
  assert.deepEqual(r.b.map(x => x.ref), ['rent:b:2025-01', 'rent:b:2025-02', 'bill:x:b']);
  assert.equal(r.o, undefined);
  const billA = r.a.find(x => x.type === 'bill');
  assert.equal(billA.due, '2025-02-16');
  assert.equal(billA.cents, Math.round(6200 * 16 / 78));                     // 人·天：o 31、a 16、b 31
});

test('先到期先抵、预付、退款', () => {
  const items = [
    { ref: 'rent:a:2025-01', type: 'rent', due: '2025-01-16', cents: 1000 },
    { ref: 'bill:x:a', type: 'bill', due: '2025-02-16', cents: 300 },
    { ref: 'rent:a:2025-02', type: 'rent', due: '2025-02-16', cents: 1000 },
    { ref: 'adj:1', type: 'adj', due: '2025-02-16', cents: -100 },
  ];
  const r = settle(items, [{ id: 'p1', date: '2025-01-20', amount: 15 }, { id: 'p2', date: '2025-02-20', amount: 10 }]);
  // 贷方：p1 $15、减免 $1、p2 $10 = 2600 分；借方 1000 + 1000(rent 先于 bill) + 300
  assert.deepEqual(r.debits.map(d => [d.ref, d.remaining]), [['rent:a:2025-01', 0], ['rent:a:2025-02', 0], ['bill:x:a', 0]]);
  assert.equal(r.credit, 300);
  // 收 $30 + 减免 $1 = 3100 分；应收 2300 + 退款 200 = 2500 分；剩 600 分预付
  const r2 = settle(items, [{ id: 'p1', date: '2025-01-20', amount: 30 }, { id: 'p3', date: '2025-03-01', amount: -2 }]);
  assert.equal(r2.credit, 600);
  assert.equal(r2.debits.find(d => d.type === 'refund').remaining, 0);
});

test('整本账：余额、逾期、本期统计', () => {
  const s = fixture();
  s.data.bills.x = { id: 'x', providerId: 'p_e', statementDate: '2025-02-05', periodStart: '2025-01-01', periodEnd: '2025-02-01', total: 62, allocation: { mode: 'manual', shares: { o: 31, a: 16, b: 15 } }, collectPeriod: '2025-02', updatedAt: 1 };
  s.data.payments.p1 = { id: 'p1', residentId: 'a', date: '2025-01-18', amount: 1000, method: 'zelle', updatedAt: 1 };
  s.data.payments.p2 = { id: 'p2', residentId: 'a', date: '2025-02-17', amount: 500, method: 'zelle', updatedAt: 1 };
  s.data.adjustments.o1 = { id: 'o1', residentId: 'b', collectPeriod: '2025-01', amount: 40, kind: 'opening', label: '期初', updatedAt: 1 };
  const L = buildLedger(s, '2025-02-25');
  const a = L.people.a;
  assert.equal(a.balance, 1000 + 1000 + 16 - 1500);
  assert.equal(a.outstanding, 516);
  assert.equal(a.overdue, 516);              // 2/16 到期 + 3 天宽限 < 2/25
  assert.equal(a.overdueDays, 9);
  const P = L.period('2025-02');
  assert.equal(P.start, '2025-02-16');
  const pa = P.people.a;
  assert.equal(pa.E, 1016);
  assert.equal(pa.C, 500);
  assert.equal(pa.status, 'partial');
  assert.equal(pa.previous, 0);              // 1 月的房租 1/18 就交了
  assert.equal(pa.paidSince, 500);
  assert.equal(pa.due, 516);
  const pb = P.people.b;
  assert.equal(pb.rentE, Math.round(90000 * 13 / 28) / 100);
  assert.equal(L.period('2025-01').people.b.E, 940);
  assert.equal(P.billE, 31);
  assert.equal(L.current, '2025-02');
});

test('没设开账期：不生成房租，只算标了收款期的账单', () => {
  const s = fixture();
  delete s.settings.ledgerStart;
  const r = receivables(s, '2025-02-20');
  assert.deepEqual(r.a, []);
});

test('本期合计只算正的应收：一个人的抵扣不冲掉另一个人的欠款', async () => {
  const s = fixture();
  s.settings.ledgerStart = '2025-02';
  s.data.residents.b.moveOut = '2025-02-16';          // Bob 2 月期不在
  s.data.adjustments.d = { id: 'd', residentId: 'a', collectPeriod: '2025-02', amount: -100, kind: 'discount', label: 'x', updatedAt: 1 };
  s.data.adjustments.c = { id: 'c', residentId: 'b', collectPeriod: '2025-02', amount: -200, kind: 'other', label: 'y', updatedAt: 1 };
  const P = buildLedger(s, '2025-02-20').period('2025-02');
  assert.equal(P.E, 1000);           // 只算 Alice 的房租
  assert.equal(P.C, 100);            // 减免抵掉的
  assert.equal(P.left, 900);
  assert.equal(P.people.a.left, 900);
});

test('收整期：期中入住的人按入住那天的月租', () => {
  const r = { id: 'x', moveIn: '2026-10-20', rent: [{ from: '2026-10-20', amount: 1200 }] };
  assert.equal(rentCharge(r, '2026-10', 16, 'full').cents, 120000);
});
