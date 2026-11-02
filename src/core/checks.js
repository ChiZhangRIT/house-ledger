// 保存账单前的检查：确认页上显示，error 必须先改，warn 只是提醒。
// 每条 { level: 'error'|'warn'|'ok', code, vars }
import { dayNumber, isISODate } from './dates.js';
import { compareBill, billDays, covEnd } from './analytics.js';

const median = xs => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
const r2 = x => Math.round(x * 100) / 100;

/**
 * @param bill        正在编辑的账单（id 可能还没定）
 * @param bills       所有账单（不含已删除）
 * @param opts        { anomalyPct, anomalyMin, editingId, providers }
 */
export function billChecks(bill, bills, opts = {}) {
  const out = [];
  const others = bills.filter(b => b.id !== opts.editingId && b.providerId === bill.providerId);
  // 必填
  for (const f of ['providerId', 'statementDate', 'periodStart', 'periodEnd']) {
    if (!bill[f]) out.push({ level: 'error', code: 'missing', vars: { field: f } });
    else if (f !== 'providerId' && !isISODate(bill[f])) out.push({ level: 'error', code: 'badDate', vars: { field: f } });
  }
  if (typeof bill.total !== 'number' || !Number.isFinite(bill.total)) out.push({ level: 'error', code: 'missing', vars: { field: 'total' } });
  else if (Math.abs(bill.total) > 1e6) out.push({ level: 'error', code: 'tooBig', vars: {} });
  if (out.some(c => c.level === 'error')) return out;
  const days = billDays(bill);
  if (!(days > 0)) { out.push({ level: 'error', code: 'periodOrder', vars: {} }); return out; }
  if (bill.dueDate && isISODate(bill.dueDate) && bill.dueDate < bill.statementDate) out.push({ level: 'warn', code: 'dueBefore', vars: {} });
  if (dayNumber(bill.statementDate) < dayNumber(bill.periodStart) - 45 || dayNumber(bill.statementDate) > dayNumber(covEnd(bill)) + 45) out.push({ level: 'warn', code: 'oddStatement', vars: {} });
  if (bill.total < 0) out.push({ level: 'warn', code: 'negative', vars: {} });

  // 分项合计
  const items = (bill.items || []).filter(i => typeof i.amount === 'number');
  if (items.length) {
    const sum = r2(items.reduce((a, i) => a + i.amount, 0));
    if (Math.abs(sum - bill.total) > 0.005) out.push({ level: 'warn', code: 'itemsSum', vars: { sum, diff: r2(bill.total - sum) } });
    else out.push({ level: 'ok', code: 'itemsOk', vars: {} });
  }
  // 锁定的账单改了总额：锁着的旧金额对不上了，要先改成自动或手动分摊
  if (bill.allocation && bill.allocation.mode === 'locked' && opts.lockedTotal != null && Math.abs(opts.lockedTotal - bill.total) > 0.005) {
    const sum = r2(Object.values(bill.allocation.shares || {}).reduce((a, v) => a + (Number(v) || 0), 0));
    if (Math.abs(sum - bill.total) > 0.005) out.push({ level: 'error', code: 'lockedTotal', vars: { sum } });
  }
  // 手动分摊：各人加起来要等于总额
  if (bill.allocation && bill.allocation.mode === 'manual') {
    const sum = r2(Object.values(bill.allocation.shares || {}).reduce((a, v) => a + (Number(v) || 0), 0));
    if (Math.abs(sum - bill.total) > 0.005) out.push({ level: 'error', code: 'sharesSum', vars: { sum, diff: r2(bill.total - sum) } });
  }
  // 周期长短：和这家以往的周期比
  const typical = median(others.slice(0, 12).map(billDays).filter(d => d > 0));
  if (typical && Math.abs(days - typical) > Math.max(5, typical * 0.25)) out.push({ level: 'warn', code: 'oddDays', vars: { days, typical } });
  else out.push({ level: 'ok', code: 'daysOk', vars: { days } });
  // 和上一张接不接得上（按覆盖区间算；容许 1 天，以防账单方的计天口径没设对）
  const prev = others.filter(b => b.periodStart && b.periodStart < bill.periodStart).sort((a, b) => (a.periodStart < b.periodStart ? 1 : -1))[0];
  if (prev && prev.periodEnd) {
    const gap = dayNumber(bill.periodStart) - dayNumber(covEnd(prev));
    if (gap > 1) out.push({ level: 'warn', code: 'gap', vars: { days: gap, prevEnd: prev.periodEnd } });
    else if (gap < 0) out.push({ level: 'warn', code: 'overlap', vars: { days: -gap, prevEnd: prev.periodEnd } });
    else out.push({ level: 'ok', code: 'continuous', vars: {} });
    if (prev.accountLast4 && bill.accountLast4 && prev.accountLast4 !== bill.accountLast4) out.push({ level: 'warn', code: 'account', vars: { was: prev.accountLast4, now: bill.accountLast4 } });
  }
  // 重复
  const sha = bill.source && bill.source.sha256;
  const sameFile = sha && bills.find(b => b.id !== opts.editingId && b.source && b.source.sha256 === sha);
  if (sameFile) out.push({ level: 'warn', code: 'dupFile', vars: { id: sameFile.id, date: sameFile.statementDate } });
  const sameDate = others.find(b => b.statementDate === bill.statementDate);
  const overlapping = others.find(b => b.periodStart && b.periodEnd && overlapShare(b, bill) > 0.5);
  if (sameDate && sameDate !== sameFile) out.push({ level: 'warn', code: 'dupDate', vars: { id: sameDate.id, date: sameDate.statementDate } });
  else if (overlapping && overlapping !== sameFile) out.push({ level: 'warn', code: 'dupPeriod', vars: { id: overlapping.id, start: overlapping.periodStart, end: overlapping.periodEnd } });
  // 和去年同一段日期比（同一类别：网费换过公司也能比）
  const providers = opts.providers || {};
  const cat = (providers[bill.providerId] || {}).category;
  const sameCat = cat ? bills.filter(b => b.id !== opts.editingId && (providers[b.providerId] || {}).category === cat) : others;
  const th = (Number(opts.anomalyPct) || 40) / 100, minAmt = opts.anomalyMin == null ? 20 : Number(opts.anomalyMin);
  const cmp = compareBill({ ...bill, id: bill.id || '__new' }, sameCat);
  if (cmp.lastYear && cmp.lastYear.perDayChange != null) {
    const pct = cmp.lastYear.perDayChange;
    if (pct > th && (bill.total / days - cmp.lastYear.perDay) * days >= minAmt) out.push({ level: 'warn', code: 'high', vars: { pct } });
    else if (pct < -th) out.push({ level: 'ok', code: 'low', vars: { pct } });
  }
  // 网费一般每月一样：变了提醒一下
  if (cat === 'internet' && cmp.prev && Math.abs(cmp.prev.bill.total - bill.total) >= 1) out.push({ level: 'warn', code: 'netChanged', vars: { was: cmp.prev.bill.total, now: bill.total } });
  return out;
}

function overlapShare(a, b) {
  const s = Math.max(dayNumber(a.periodStart), dayNumber(b.periodStart)), e = Math.min(dayNumber(a.periodEnd), dayNumber(b.periodEnd));
  const len = Math.min(billDays(a), billDays(b));
  return len > 0 ? Math.max(0, e - s) / len : 0;
}
