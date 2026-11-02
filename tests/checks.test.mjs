// 账单检查测试（合成数据）
import test from 'node:test';
import assert from 'node:assert/strict';
import { billChecks } from '../src/core/checks.js';

const base = { providerId: 'p', items: [], allocation: { mode: 'auto' } };
const hist = ['01', '02', '03'].map((m, i) => ({ ...base, id: 'h' + i, statementDate: `2025-${m}-10`, periodStart: `2025-${m}-01`, periodEnd: `2025-0${i + 2}-01`, total: 60 }));
const codes = cs => cs.map(c => c.code);

test('缺字段、日期顺序', () => {
  assert.deepEqual(codes(billChecks({ ...base, total: null }, hist)), ['missing', 'missing', 'missing', 'missing']);
  const c = billChecks({ ...base, statementDate: '2025-04-10', periodStart: '2025-04-30', periodEnd: '2025-04-01', total: 1 }, hist);
  assert.deepEqual(codes(c), ['periodOrder']);
});

test('正常的账单：分项相符、天数正常、接上期', () => {
  const b = { ...base, statementDate: '2025-04-10', periodStart: '2025-04-01', periodEnd: '2025-05-01', total: 61, items: [{ key: 'gas', amount: 21 }, { key: 'electric_delivery', amount: 40 }] };
  const c = billChecks(b, hist);
  assert.ok(c.every(x => x.level === 'ok'), JSON.stringify(c));
  assert.deepEqual(codes(c), ['itemsOk', 'daysOk', 'continuous']);
});

test('分项不符、空档、重复、手动分摊不符', () => {
  const b = { ...base, statementDate: '2025-03-10', periodStart: '2025-04-05', periodEnd: '2025-05-05', total: 61, items: [{ key: 'gas', amount: 50 }], allocation: { mode: 'manual', shares: { a: 30, b: 30 } } };
  const c = billChecks(b, hist);
  assert.ok(codes(c).includes('itemsSum'));
  assert.equal(c.find(x => x.code === 'itemsSum').vars.diff, 11);
  assert.ok(codes(c).includes('sharesSum'));
  assert.equal(c.find(x => x.code === 'gap').vars.days, 4);
  assert.ok(codes(c).includes('dupDate'));
});

test('编辑已有账单时不和自己比重复', () => {
  const c = billChecks({ ...hist[2] }, hist, { editingId: 'h2' });
  assert.ok(!codes(c).includes('dupDate') && !codes(c).includes('dupPeriod'), codes(c).join());
});

test('同一个文件导入两次', () => {
  const h = [{ ...hist[0], source: { sha256: 'abc' } }];
  const c = billChecks({ ...base, statementDate: '2025-06-10', periodStart: '2025-06-01', periodEnd: '2025-07-01', total: 5, source: { sha256: 'abc' } }, h);
  assert.ok(codes(c).includes('dupFile'));
});

test('含结束日的账单：接上期按覆盖区间算；网费变了提醒；负数提示', () => {
  const P = { n: { id: 'n', category: 'internet' } };
  const h1 = [{ ...base, providerId: 'n', id: 'n1', statementDate: '2025-01-20', periodStart: '2025-01-21', periodEnd: '2025-02-20', endInclusive: true, total: 65 }];
  const b = { ...base, providerId: 'n', statementDate: '2025-02-20', periodStart: '2025-02-21', periodEnd: '2025-03-20', endInclusive: true, total: 70 };
  const c = billChecks(b, h1, { providers: P });
  assert.ok(codes(c).includes('continuous'), codes(c).join());
  assert.ok(codes(c).includes('netChanged'));
  const neg = billChecks({ ...b, total: -5 }, h1, { providers: P });
  assert.ok(codes(neg).includes('negative'));
});
