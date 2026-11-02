// 首页的待办提醒，按严重程度排序。每条 { level: 'critical'|'warn'|'info', code, vars, link, key?（可忽略的才有） }
// - rentLate / overdue：室友逾期（过了宽限天数还没付清）
// - billOverdue / billDue：给公司的账单过期或快到期，还没标记已缴（开了自动扣款的公司、开账期之前的账单不提醒）
// - movedOut：已搬出的住户还有余额
// - high：最新一张账单的日均费用比去年同一段日期高出阈值（而且多出来的钱不少于 $20）
// - missing：按以往的出账间隔，新账单应该已经出了但还没录入（可忽略）
// - gap：同一家公司最近两张账单之间有空档（可忽略）
// - noRent：住户没设月租，房租算不出来
// - noLedger：还没设开账期
import { dayNumber, addDays } from './dates.js';
import { compareBill, billDays } from './analytics.js';
import { periodStart } from './ledger.js';

const median = xs => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
const ORDER = { critical: 0, warn: 1, info: 2 };

export function alerts(state, D) {
  const out = [], todayIso = D.today;
  const pctTh = (Number(state.settings.anomalyPct) || 40) / 100, minAmt = state.settings.anomalyMin == null ? 20 : Number(state.settings.anomalyMin);
  const startIso = state.settings.ledgerStart ? periodStart(state.settings.ledgerStart, D.ledger.cd) : null;
  const dismissed = new Set(Object.values(state.data.dismissals || {}).filter(x => !x.deleted).map(x => x.key));
  const names = Object.fromEntries(D.residents.map(r => [r.id, r.name]));

  for (const [rid, p] of Object.entries(D.ledger.people)) {
    if (p.overdue > 0.005) out.push({ level: 'critical', code: 'overdue', vars: { name: names[rid] || rid, amount: p.overdue, days: p.overdueDays }, link: 'person/' + rid });
    const r = D.residents.find(x => x.id === rid);
    if (r && r.moveOut && r.moveOut <= todayIso && Math.abs(p.balance) > 0.005) out.push({ level: 'warn', code: 'movedOut', vars: { name: r.name, amount: p.balance }, link: 'person/' + rid });
    if (p.unknownRent.length) out.push({ level: 'info', code: 'noRent', vars: { name: names[rid] || rid, n: p.unknownRent.length }, link: 'residents' });
  }
  if (!state.settings.ledgerStart && D.residents.some(r => !r.isOwner)) out.push({ level: 'info', code: 'noLedger', vars: {}, link: 'settings' });

  for (const p of D.providerList) {
    const list = D.bills.filter(b => b.providerId === p.id && b.statementDate).sort((a, b) => (a.statementDate < b.statementDate ? -1 : 1));
    if (!list.length) continue;
    const last = list[list.length - 1];
    if (p.active !== false && list.length >= 2) {
      const gaps = list.slice(-7).map((b, i, a) => (i ? dayNumber(b.statementDate) - dayNumber(a[i - 1].statementDate) : null)).filter(x => x != null);
      const expected = addDays(last.statementDate, median(gaps));
      const key = `missing:${p.id}:${expected}`;
      if (dayNumber(todayIso) - dayNumber(expected) > (Number(state.settings.expectLateDays) || 5) && !dismissed.has(key))
        out.push({ level: 'warn', code: 'missing', vars: { provider: p.name, expected }, link: 'add', key });
    }
    if (!p.autopay) {
      for (const b of list) {
        if (!b.dueDate || b.paidAt || (b.source && b.source.method === 'import') || (startIso && b.statementDate < startIso)) continue;
        const left = dayNumber(b.dueDate) - dayNumber(todayIso);
        if (left < 0) out.push({ level: 'critical', code: 'billOverdue', vars: { provider: p.name, due: b.dueDate, amount: b.total }, link: 'bill/' + b.id });
        else if (left <= 7) out.push({ level: 'warn', code: 'billDue', vars: { provider: p.name, due: b.dueDate, amount: b.total, days: left }, link: 'bill/' + b.id });
      }
    }
    // 最近 60 天内出的账单才提醒偏高
    if (dayNumber(todayIso) - dayNumber(last.statementDate) <= 60) {
      const same = D.bills.filter(b => (D.providers[b.providerId] || {}).category === p.category);
      const c = compareBill(last, same);
      const key = 'high:' + last.id;
      if (c.lastYear && c.lastYear.perDayChange > pctTh && (last.total / billDays(last) - c.lastYear.perDay) * billDays(last) >= minAmt && !dismissed.has(key))
        out.push({ level: 'warn', code: 'high', vars: { provider: p.name, pct: c.lastYear.perDayChange }, link: 'bill/' + last.id, key });
    }
    if (list.length >= 2) {
      const [a, b] = list.slice(-2);
      const end = a.endInclusive ? addDays(a.periodEnd, 1) : a.periodEnd;
      const gap = a.periodEnd && b.periodStart ? dayNumber(b.periodStart) - dayNumber(end) : 0;
      const key = 'gap:' + b.id;
      if (gap > 1 && !dismissed.has(key) && !(b.ack && b.ack.gap)) out.push({ level: 'info', code: 'gap', vars: { provider: p.name, days: gap }, link: 'bill/' + b.id, key });
    }
  }
  return out.sort((a, b) => ORDER[a.level] - ORDER[b.level]);
}
