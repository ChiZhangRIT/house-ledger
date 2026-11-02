// 待办提醒测试（合成数据）
import test from 'node:test';
import assert from 'node:assert/strict';
import { blankState, live } from '../src/core/store.js';
import { alerts } from '../src/core/alerts.js';
import { buildLedger } from '../src/core/ledger.js';

function derive(s, today) {
  const D = { today, providers: s.data.providers, providerList: live(s, 'providers'), bills: live(s, 'bills'), residents: live(s, 'residents') };
  D.ledger = buildLedger(s, today, D);
  return D;
}
function fixture() {
  const s = blankState();
  s.data.providers.p = { id: 'p', name: 'Power Co', category: 'energy', active: true, updatedAt: 1 };
  s.data.residents.o = { id: 'o', name: 'Owner', moveIn: '2020-01-01', isOwner: true, weights: [], updatedAt: 1 };
  s.data.residents.a = { id: 'a', name: 'Alice', moveIn: '2025-01-16', weights: [], rent: [{ from: '2025-01-16', amount: 900 }], updatedAt: 1 };
  s.settings.rentCycleDay = 16;
  s.settings.ledgerStart = '2025-01';
  const months = ['2025-01', '2025-02', '2025-03', '2025-04'];
  months.forEach((m, i) => {
    const id = 'b' + i;
    s.data.bills[id] = { id, providerId: 'p', statementDate: m + '-10', periodStart: `${m}-01`, periodEnd: months[i + 1] ? `${months[i + 1]}-01` : '2025-05-01', dueDate: m + '-28', total: 60, allocation: { mode: 'auto' }, source: { method: 'pdf' }, paidAt: i < 3 ? m + '-20' : null, updatedAt: 1 };
  });
  return s;
}

test('缺账单、到期、室友逾期', () => {
  const s = fixture();
  const list = alerts(s, derive(s, '2025-05-25'));
  const codes = list.map(a => a.code);
  assert.ok(codes.includes('missing'), codes.join());   // 每月 10 号左右出账，5/25 还没有 5 月的
  assert.ok(codes.includes('billOverdue'));             // 4/28 到期没标记已缴
  assert.ok(codes.includes('overdue'));                 // Alice 的房租一直没交
  assert.equal(list[0].level, 'critical');
});

test('忽略过的提醒不再出现；自动扣款的不提醒到期', () => {
  const s = fixture();
  const D = derive(s, '2025-05-25');
  const missing = alerts(s, D).find(a => a.code === 'missing');
  s.data.dismissals['dis_' + missing.key] = { id: 'dis_' + missing.key, key: missing.key, updatedAt: 1 };
  s.data.providers.p.autopay = true;
  const codes = alerts(s, derive(s, '2025-05-25')).map(a => a.code);
  assert.ok(!codes.includes('missing') && !codes.includes('billOverdue'), codes.join());
});

test('比去年同期高、周期有空档、没设月租、没设开账期', () => {
  const s = fixture();
  s.data.bills.ly = { id: 'ly', providerId: 'p', statementDate: '2024-04-10', periodStart: '2024-04-01', periodEnd: '2024-05-01', total: 30, allocation: { mode: 'auto' }, updatedAt: 1 };
  s.data.bills.b3.periodStart = '2025-04-05';
  s.data.bills.b3.total = 80;
  s.data.residents.a.rent = [];
  let list = alerts(s, derive(s, '2025-04-20'));
  assert.ok(list.find(a => a.code === 'high').vars.pct > 1);
  assert.equal(list.find(a => a.code === 'gap').vars.days, 4);
  assert.ok(list.some(a => a.code === 'noRent'));
  delete s.settings.ledgerStart;
  list = alerts(s, derive(s, '2025-04-20'));
  assert.ok(list.some(a => a.code === 'noLedger'));
});
