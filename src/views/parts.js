// 几个页面共用的小部件：账单行、涨跌标签、分摊表、对比表
import { h } from '../ui/dom.js';
import { t, money, pct, period, date, num, rate, unitLabel } from '../i18n.js';
import { providerColor, personColor } from '../ui/colors.js';
import { billStats, compareBill, billShares, splitCategory, covEnd, shiftYear, explainChange } from '../core/analytics.js';
import { overlapDays, dayNumber, addDays } from '../core/dates.js';
import { weightOn, participates } from '../core/split.js';
import { periodStart } from '../core/ledger.js';

export const providerOf = (ctx, b) => ctx.D.providers[b.providerId] || { name: '?', category: 'internet' };
export const residentName = (ctx, id) => { const r = ctx.S.data.residents[id]; return r && !r.deleted ? r.name : (r && r.name) || t('res.unknown'); };
export const dot = color => h('span.dot', { style: { background: color }, 'aria-hidden': 'true' });
export const avatar = (r) => h('span.avatar', { style: { background: personColor(r.id) }, 'aria-hidden': 'true' }, (r.name || '?').trim().slice(0, 1).toUpperCase());

/** 涨跌标签：▲ +12% / ▼ −7%；超过阈值的涨幅用警示样式（图标 + 文字，不只靠颜色） */
export function changeTag(v, { threshold = 0.3, label } = {}) {
  if (v == null || !Number.isFinite(v)) return null;
  const up = v > 0.005, down = v < -0.005;
  const cls = up && v > threshold ? '.warn' : '';
  return h('span.tag' + cls, { title: label || '' }, up ? '▲ ' : down ? '▼ ' : '', pct(v), label ? h('span.tag-label', null, ' ' + label) : null);
}

/** 账单状态小标记 */
export function billBadges(b, ctx) {
  const out = [];
  if (b.allocation && b.allocation.mode === 'locked') out.push(h('span.badge', { title: t('bill.lockedHint') }, '🔒 ' + t('bill.locked')));
  if (b.allocation && b.allocation.mode === 'manual') out.push(h('span.badge', null, t('bill.manual')));
  const p = providerOf(ctx, b);
  const start = ctx.S.settings.ledgerStart ? periodStart(ctx.S.settings.ledgerStart, ctx.D.ledger.cd) : null;   // 开账期之前的账单视为早已缴清
  if (b.dueDate && !b.paidAt && !p.autopay && !(b.source && b.source.method === 'import') && !(start && b.statementDate < start))
    out.push(h('span.badge.warn', null, '⚠ ' + (b.dueDate < ctx.D.today ? t('bill.overdue') : t('bill.unpaid'))));
  return out;
}

/** 列表里的一行账单 */
export function billRow(b, ctx, { showProvider = true } = {}) {
  const p = providerOf(ctx, b), st = billStats(b);
  const cmp = compareBill(b, ctx.D.sameCategory(b));
  const usage = (b.usage || []).filter(u => u.key !== 'data').map(u => num(u.amount, u.amount < 100 && u.amount % 1 ? 1 : 0) + ' ' + unitLabel(u.unit)).join(' · ');
  return h('a.bill-row', { href: '#/bill/' + encodeURIComponent(b.id) },
    h('div.bill-row-main', null,
      h('div.bill-row-title', null, dot(providerColor(p)), showProvider ? h('b', null, p.name) : null, h('span.muted', null, period(b.periodStart, b.periodEnd))),
      h('div.bill-row-sub', null,
        st.days ? h('span', null, t('bill.days', { n: st.days })) : null,
        st.perDay != null ? h('span', null, t('bill.perDay', { amount: st.perDay })) : null,
        usage ? h('span', null, usage) : null,
        billBadges(b, ctx))),
    h('div.bill-row-amt', null, h('b.num', null, money(b.total)),
      cmp.lastYear ? changeTag(cmp.lastYear.perDayChange, { threshold: (Number(ctx.S.settings.anomalyPct) || 30) / 100, label: t('cmp.yoyShort') }) : null));
}

/** 分摊表：名字、在住天数、权重、人·天、金额 */
export function splitTable(bill, ctx, { residents, onResident } = {}) {
  const p = providerOf(ctx, bill);
  const res = residents || ctx.D.residents;
  const r = billShares(bill, p, res);
  const personCell = person => h('th', null, onResident && ctx.S.data.residents[person.id] && !person.deleted
    ? h('button.link-btn.split-person', { type: 'button', 'aria-label': t('res.edit') + ' · ' + person.name, onclick: () => onResident(person) }, avatar(person), person.name)
    : [avatar(person), ' ', person.name]);
  const rows = [];
  if (r.mode === 'auto') {
    const totalPD = (r.basis || []).reduce((a, b) => a + b.personDays, 0);
    for (const b of r.basis || []) {
      const person = res.find(x => x.id === b.id);
      const days = overlapDays(person.moveIn, person.moveOut || '9999-12-31', bill.periodStart, covEnd(bill));
      // 权重按他在这期里第一天和最后一天住着的时候取
      const first = person.moveIn > bill.periodStart ? person.moveIn : bill.periodStart;
      const lastEx = person.moveOut && person.moveOut < covEnd(bill) ? person.moveOut : covEnd(bill);
      const w1 = weightOn(person, first), w2 = weightOn(person, addDays(lastEx, -1));
      const name = personCell(person);
      if (b.absorbed != null) name.append(h('div.sub', null, t('split.absorbed', { amount: b.absorbed })));
      rows.push(h('tr', null,
        name,
        h('td.num', null, num(days)),
        h('td.num', null, w1 === w2 ? '×' + num(w1, w1 % 1 ? 1 : 0) : `×${w1}→×${w2}`),
        h('td.num', null, num(b.personDays)),
        h('td.num', null, pct(b.personDays / totalPD, { sign: false, digits: 1 })),
        h('td.num', null, h('b', null, money(r.shares[b.id] || 0)))));
    }
    const excluded = res.filter(x => !participates(x, splitCategory(p)) && overlapDays(x.moveIn, x.moveOut || '9999-12-31', bill.periodStart, covEnd(bill)) > 0);
    const table = h('table.data-table.split-table', null,
      h('thead', null, h('tr', null, h('th', null, t('split.person')), h('th.num', null, t('split.days')), h('th.num', null, t('split.weight')), h('th.num', null, t('split.pd')), h('th.num', null, t('split.ratio')), h('th.num', null, t('split.amount')))),
      h('tbody', null, rows),
      h('tfoot', null, h('tr', null, h('th', null, t('split.total')), h('td'), h('td'), h('td.num', null, num(totalPD)), h('td.num', null, '100%'), h('td.num', null, h('b', null, money(bill.total))))));
    return h('div.split', null, h('div.table-scroll', null, table),
      r.fallback ? h('p.note', null, t('split.fallback')) : h('p.note', null, t('split.formula', { total: bill.total, pd: num(totalPD) })),
      excluded.length ? h('p.note', null, t('split.excluded', { names: excluded.map(x => x.name).join(', ') })) : null);
  }
  const sum = Object.values(r.shares).reduce((a, v) => a + v, 0);
  for (const [id, amt] of Object.entries(r.shares)) {
    const person = ctx.S.data.residents[id] || { id, name: id };
    rows.push(h('tr', null, personCell(person), h('td.num', null, h('b', null, money(amt)))));
  }
  return h('div.split', null,
    h('table.data-table.split-table', null,
      h('thead', null, h('tr', null, h('th', null, t('split.person')), h('th.num', null, t('split.amount')))),
      h('tbody', null, rows),
      h('tfoot', null, h('tr', null, h('th', null, t('split.total')), h('td.num', null, h('b', null, money(sum)))))),
    h('p.note', null, r.mode === 'locked' ? t('split.lockedNote') : t('split.manualNote')),
    Math.abs(sum - bill.total) > 0.005 ? h('p.note.warn-text', null, '⚠ ' + t('split.offBy', { diff: Math.round((bill.total - sum) * 100) / 100 })) : null);
}

/** 对比表：本期 / 上一张 / 去年同一段日期，都按每天算 */
export function compareTable(bill, ctx) {
  const c = compareBill(bill, ctx.D.sameCategory(bill));
  const cols = [{ label: t('cmp.this'), b: bill }, c.prev && { label: t('cmp.prev'), b: c.prev.bill }, c.lastYear && { label: t('cmp.lastYear'), b: c.lastYear.bill }].filter(Boolean);
  if (cols.length < 2) return h('p.muted', null, t('cmp.none'));
  const stats = cols.map(x => billStats(x.b));
  const row = (label, f, { change } = {}) => h('tr', null, h('th', null, label), ...stats.map((s, i) => {
    const v = f(s, cols[i].b);
    const base = f(stats[0], bill);
    const chg = change && i > 0 && typeof v === 'number' && typeof base === 'number' && v ? (base - v) / Math.abs(v) : null;
    return h('td.num', null, typeof v === 'number' ? (change ? change.fmt(v) : num(v)) : v, chg != null ? h('div.sub', null, (chg > 0 ? '▲ ' : chg < 0 ? '▼ ' : '') + pct(chg)) : null);
  }));
  const usageKeys = Object.keys(stats[0].usage).filter(k => k !== 'data');
  const rateKeys = Object.keys(stats[0].rates);
  return h('div.table-scroll', null, h('table.data-table.compare-table', null,
    h('thead', null, h('tr', null, h('th'), ...cols.map(x => h('th.num', null, x.label, h('div.sub', null,
      x.b.pseudo ? period(shiftYear(bill.periodStart, -1), shiftYear(bill.periodEnd, -1)) : period(x.b.periodStart, x.b.periodEnd)))))),
    h('tbody', null,
      row(t('cmp.days'), s => s.days),
      row(t('cmp.total'), (s, b) => b.total, { change: { fmt: v => money(v) } }),
      row(t('cmp.perDay'), s => s.perDay, { change: { fmt: v => money(v) } }),
      usageKeys.map(k => row(t('usage.perDay.' + k), s => (s.usage[k] ? s.usage[k].perDay : '—'), { change: { fmt: v => num(v, v < 10 ? 2 : 1) + ' ' + unitLabel(stats[0].usage[k].unit) } })),
      rateKeys.map(k => row(t('rate.' + k), s => (s.rates[k] ? s.rates[k].value : '—'), { change: { fmt: v => rate(v, stats[0].rates[k].unit) } })))),
    explainLine(bill, ctx, c),
    h('p.note', null, t('cmp.note'), c.lastYear ? ' ' + t('cmp.lyNote', { n: c.lastYear.bill.sources.length }) : ''));
}

/** 一句话说明变化的原因：在住人数、人均日用量、单价（和去年同期比；没有去年就和上一张比） */
export function explainLine(bill, ctx, c = compareBill(bill, ctx.D.sameCategory(bill))) {
  const ref = c.lastYear ? c.lastYear.bill : c.prev ? c.prev.bill : null;
  if (!ref) return null;
  const ex = explainChange(bill, ref, ctx.D.residents);
  const parts = Object.entries(ex).map(([k, x]) => {
    const f = [['heads', x.heads], ['perCapita', x.perCapita], ['price', x.price], ...(c.lastYear ? [] : [['days', x.days]])]
      .filter(([, v]) => Math.abs(v) >= 0.05).map(([n, v]) => t('why.' + n) + ' ' + pct(v));
    return f.length ? t('usage.' + k) + t('p.colon') + f.join(t('p.comma')) : null;
  }).filter(Boolean);
  if (!parts.length) return null;
  return h('p.explain', null, h('b', null, (c.lastYear ? t('why.vsLastYear') : t('why.vsPrev')) + ' '), parts.join(t('p.sep')));
}

/** 一组检查结果 */
export function checkList(checks) {
  const bad = checks.filter(c => c.level !== 'ok'), good = checks.filter(c => c.level === 'ok');
  return h('div.checks', null,
    bad.map(c => h('div.check.' + c.level, null, h('span.check-icon', { 'aria-hidden': 'true' }, c.level === 'error' ? '✕' : '⚠'), h('span', null, t('check.' + c.code, { ...c.vars, field: c.vars.field ? t('field.' + c.vars.field) : undefined })))),
    good.length ? h('div.check.ok', null, h('span.check-icon', { 'aria-hidden': 'true' }, '✓'), h('span', null, good.map(c => t('check.' + c.code, c.vars)).join(' · '))) : null);
}

/** 状态标签：图标 + 文字（不只靠颜色） */
const ST_ICON = { good: '✓', warning: '○', critical: '!', credit: '+', none: '—', partial: '◐', unknown: '?' };
export const statusChip = (kind, text) => h('span.status.' + kind, null, h('span.status-icon', { 'aria-hidden': 'true' }, ST_ICON[kind] || ''), text);

export const emptyState = (text, action) => h('div.empty', null, h('p', null, text), action || null);
export { dayNumber, date };
