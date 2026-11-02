// 明细测试（合成数据）
import test from 'node:test';
import assert from 'node:assert/strict';
import { blankState } from '../src/core/store.js';
import { buildLedger } from '../src/core/ledger.js';
import { buildStatement } from '../src/core/statement.js';

test('明细：房租、账单份额和计算过程、已付、应付合计', () => {
  const s = blankState();
  s.data.providers.p = { id: 'p', name: 'Power Co', category: 'energy', updatedAt: 1 };
  s.data.residents.o = { id: 'o', name: 'Owner', moveIn: '2020-01-01', isOwner: true, weights: [], updatedAt: 1 };
  s.data.residents.a = { id: 'a', name: 'Alice Example', shortName: 'Alice', moveIn: '2025-01-16', weights: [], rent: [{ from: '2025-01-16', amount: 900 }], updatedAt: 1 };
  s.data.bills.x = { id: 'x', providerId: 'p', statementDate: '2025-02-05', periodStart: '2025-01-16', periodEnd: '2025-02-15', endInclusive: true, total: 60, allocation: { mode: 'auto' }, collectPeriod: '2025-02', updatedAt: 1 };
  s.data.payments.p1 = { id: 'p1', residentId: 'a', date: '2025-02-17', amount: 900, method: 'zelle', updatedAt: 1 };
  Object.assign(s.settings, { rentCycleDay: 16, ledgerStart: '2025-02', graceDays: 3 });
  const ledger = buildLedger(s, '2025-02-20');
  const st = buildStatement({ state: s, ledger, residentId: 'a', period: '2025-02', lang: 'zh', today: '2025-02-20', payInstructions: 'Zelle 123' });
  assert.match(st.text, /2025年2月期 · 2\/16–3\/15 明细 · Alice/);
  assert.match(st.text, /房租 2\/16–3\/15  \$900\.00/);
  assert.match(st.text, /你住 31 天 × 1 = 31 ÷ 全屋 62 人·天 = 50\.00%  \$30\.00/);
  assert.match(st.text, /本期已付  −\$900\.00/);
  assert.match(st.text, /应付合计 \$30\.00 · 请于 2\/19 前付款/);
  assert.match(st.text, /付款方式：Zelle 123/);
  assert.ok(!st.text.includes('Owner'));            // 不写其他住户的名字
  assert.equal(st.totalDue, 30);
  const en = buildStatement({ state: s, ledger, residentId: 'a', period: '2025-02', lang: 'en', today: '2025-02-20' });
  assert.match(en.text, /Feb 2025 statement \(2\/16–3\/15\) · Alice/);
  assert.match(en.text, /Amount due \$30\.00/);
});
