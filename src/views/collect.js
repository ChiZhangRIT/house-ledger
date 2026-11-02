// 收款：按收款期对账（本期表）或者看多期的矩阵。房租 + 水电网份额 + 调整，先到期先抵。
import { h } from '../ui/dom.js';
import { t, money, date, period, pct } from '../i18n.js';
import { nextPeriod, prevPeriod, periodRange } from '../core/ledger.js';
import { today } from '../core/dates.js';
import { billShares } from '../core/analytics.js';
import { avatar, statusChip, emptyState, providerOf } from './parts.js';
import { periodTitle, personStatus } from './overview.js';
import { openPayment, openAdjustment, openStatement, openPeriodCell } from './money.js';

const STATUS = { paid: ['good', 'st.paid'], partial: ['partial', 'st.partial'], overdue: ['critical', 'st.late'], due: ['warning', 'st.open'], credit: ['credit', 'st.creditP'], none: ['none', 'st.none'], unknown: ['unknown', 'st.unknown'] };

export function render(root, ctx, [keyParam]) {
  const D = ctx.D, L = D.ledger, S = ctx.S;
  const people = D.residents.filter(r => !r.isOwner);
  if (!people.length) { root.append(emptyState(t('collect.noPeople'), h('a.btn.primary', { href: '#/residents' }, t('nav.residents')))); return; }
  if (!S.settings.ledgerStart) {
    root.append(h('section.card', null, h('h2.section-h', null, t('collect.startH')), h('p', null, t('collect.startP')),
      h('button.btn.primary', { type: 'button', onclick: () => ctx.setSetting('ledgerStart', L.current) }, t('collect.startBtn', { p: periodTitle(L.current, L.period(L.current)) }))));
  }
  const key = /^\d{4}-(0[1-9]|1[0-2])$/.test(keyParam || '') ? keyParam : L.current;
  const view = ctx.L.prefs.collectView === 'matrix' ? 'matrix' : 'table';
  root.append(h('div.filters', null,
    h('div.period-head.inline', null,
      h('button.icon-btn', { type: 'button', 'aria-label': t('period.prev'), onclick: () => ctx.nav('collect/' + prevPeriod(key)) }, '‹'),
      h('h2', null, periodTitle(key, L.period(key))),
      h('button.icon-btn', { type: 'button', 'aria-label': t('period.next'), onclick: () => ctx.nav('collect/' + nextPeriod(key)) }, '›'),
      key !== L.current ? h('button.link-btn', { type: 'button', onclick: () => ctx.nav('collect') }, t('period.current')) : null),
    h('div.seg-tabs', { role: 'tablist' }, ['table', 'matrix'].map(v => h('button.seg-tab' + (v === view ? '.on' : ''), { type: 'button', role: 'tab', 'aria-selected': String(v === view), onclick: () => { ctx.setPref('collectView', v); ctx.render(); } }, t('collect.' + v)))),
    h('div.row', null,
      h('button.btn.primary', { type: 'button', onclick: () => openPayment(ctx, { periodKey: key }) }, '＋ ' + t('pay.title')),
      h('button.btn', { type: 'button', onclick: () => openStatement(ctx, { periodKey: key }) }, t('st.title')),
      h('button.btn', { type: 'button', onclick: () => openAdjustment(ctx) }, t('adj.title')))));
  if (view === 'matrix') matrix(root, ctx, key); else table(root, ctx, key);
}

function table(root, ctx, key) {
  const D = ctx.D, L = D.ledger, P = L.period(key);
  const sent = lastExports(ctx);
  const start = ctx.S.settings.ledgerStart;
  if (start && key < start) root.append(h('p.note', null, t('collect.beforeLedger', { p: t('period.m', { m: Number(start.slice(5)), y: start.slice(0, 4) }) })));
  root.append(h('section.stats', null,
    stat(t('collect.E'), money(P.E), t('collect.EParts', { rent: P.rentE, bills: P.billE })),
    stat(t('collect.C'), money(P.C), P.E > 0 ? t('collect.rate', { pct: pct(P.C / P.E, { sign: false }) }) : '—'),
    stat(t('collect.left'), money(P.left), ''),
    stat(t('collect.received'), money(P.received), t('collect.receivedHint'))));
  const rows = D.residents.filter(r => !r.isOwner && P.people[r.id] && (P.people[r.id].E || P.people[r.id].status !== 'none' || Math.abs(L.people[r.id].balance) > 0.005 || (!r.moveOut || r.moveOut > P.start) && r.moveIn < P.end));
  if (!rows.length) root.append(emptyState(t('collect.empty')));
  root.append(h('div.collect-list', null, rows.map(r => {
    const me = P.people[r.id], p = L.people[r.id];
    const [kind, label] = STATUS[me.status] || STATUS.none;
    const exp = sent[r.id + '|' + key];
    return h('section.card.collect-row', null,
      h('div.collect-row-head', null,
        h('a.person-link', { href: '#/person/' + encodeURIComponent(r.id) }, avatar(r), h('b', null, r.name)),
        statusChip(kind, t(label)),
        h('span.sp'),
        h('span.muted.small', null, t('collect.balance'), ' ', h('b.num', null, money(p.balance)))),
      h('dl.collect-nums', null,
        num(t('collect.previous'), me.previous),
        num(t('ledger.rent'), me.unknown && !me.rentE ? '—' : me.rentE, me.items.some(x => x.type === 'rent' && x.prorated) ? t('collect.prorated') : me.unknown ? t('ledger.unknownRent') : null),
        num(t('collect.bills'), me.billE),
        me.adjE ? num(t('collect.adj'), me.adjE) : null,
        num(t('collect.periodE'), me.E, null, true),
        num(t('collect.paidSince'), me.paidSince),
        num(t('collect.dueNow'), me.due, null, true)),
      h('div.collect-row-foot', null,
        exp ? h('span.small.muted', null, t('collect.sent', { date: date(today(new Date(exp.createdAt)), 'short') }),
          Math.abs(exp.totalDue - me.due) > 0.005 ? h('span.warn-text', null, ' · ' + t('collect.changed', { diff: Math.round((me.due - exp.totalDue) * 100) / 100 })) : null) : h('span.small.muted', null, t('collect.notSent')),
        h('span.sp'),
        h('button.btn.small', { type: 'button', onclick: () => openPeriodCell(ctx, r.id, key) }, t('collect.detail')),
        h('button.btn.small', { type: 'button', onclick: () => openStatement(ctx, { residentId: r.id, periodKey: key }) }, t('st.short')),
        h('button.btn.small.primary', { type: 'button', onclick: () => openPayment(ctx, { residentId: r.id, periodKey: key }) }, t('pay.short'))));
  })));
  // 本期包含的账单
  const bills = D.bills.filter(b => b.collectPeriod === key);
  root.append(h('section.card', null, h('h2.section-h', null, t('collect.billsIn')),
    bills.length ? h('table.data-table', null, h('tbody', null, bills.map(b => {
      const pr = providerOf(ctx, b);
      const sh = billShares(b, pr, D.residents).shares;
      const fromOthers = Object.entries(sh).filter(([id]) => !(ctx.S.data.residents[id] || {}).isOwner).reduce((a, [, v]) => a + v, 0);
      return h('tr', null, h('th', null, h('a', { href: '#/bill/' + encodeURIComponent(b.id) }, pr.name), h('div.sub', null, period(b.periodStart, b.periodEnd))),
        h('td.num', null, money(b.total)), h('td.num', null, t('collect.fromOthers', { amount: Math.round(fromOthers * 100) / 100 })));
    }))) : h('p.muted', null, t('collect.noBills'))));
  // 本期到账的收款
  const pays = D.payments.filter(x => x.date >= P.start && x.date < P.end);
  if (pays.length) root.append(h('section.card', null, h('h2.section-h', null, t('collect.paysIn')),
    h('table.data-table', null, h('tbody', null, pays.map(x => h('tr', null,
      h('th', null, (ctx.S.data.residents[x.residentId] || {}).name || '?', h('div.sub', null, date(x.date), ' · ', t('method.' + (x.method || 'other')), x.note ? ' · ' + x.note : '')),
      h('td.num', null, money(x.amount)),
      h('td.num', null, h('button.link-btn', { type: 'button', onclick: () => { if (confirm(t('pay.deleteConfirm'))) { const prev = ctx.remove('payments', x.id); ctx.toast(t('pay.deleted'), { action: t('undo'), onAction: () => ctx.put('payments', prev) }); } } }, t('bill.delete')))))))));
}

function matrix(root, ctx, key) {
  const D = ctx.D, L = D.ledger, S = ctx.S;
  const start = S.settings.ledgerStart;
  const n = Number(ctx.L.prefs.matrixN) || 6;
  let first = key; for (let i = 1; i < n; i++) first = prevPeriod(first);
  const keys = periodRange(first, key);
  const legacy = {};
  for (const x of Object.values(S.data.rents)) if (!x.deleted && x.paid) legacy[x.residentId + '|' + x.periodStart.slice(0, 7)] = true;
  const people = D.residents.filter(r => !r.isOwner);
  const active = people.filter(r => (!r.moveOut || r.moveOut > L.period(first).start) || Math.abs(L.people[r.id].balance) > 0.005);
  const hidden = people.length - active.length;
  const show = ctx.L.prefs.matrixAll ? people : active;
  root.append(h('section.card', null, h('div.table-scroll', null, h('table.data-table.matrix', null,
    h('thead', null, h('tr', null, h('th', null, t('collect.person')), keys.map(k => h('th.num', null, h('button.link-btn', { type: 'button', onclick: () => { ctx.setPref('collectView', 'table'); ctx.nav('collect/' + k); } }, t('period.m', { m: Number(k.slice(5)), y: k.slice(0, 4) })))), h('th.num', null, t('collect.balance')))),
    h('tbody', null, show.map(r => h('tr', null,
      h('th', null, h('a', { href: '#/person/' + encodeURIComponent(r.id) }, r.name)),
      keys.map(k => {
        const me = L.period(k).people[r.id];
        if (start && k < start || !start) return h('td.num.muted', null, legacy[r.id + '|' + k] ? h('span', { title: t('collect.legacyHint') }, '✓ ' + t('collect.legacy')) : '—');
        if (!me || me.status === 'none') return h('td.num.muted', null, '—');
        const [kind] = STATUS[me.status] || STATUS.none;
        const left = me.left;
        return h('td.num', null, h('button.cell.' + kind, { type: 'button', onclick: () => openPeriodCell(ctx, r.id, k) },
          statusChip(kind, me.status === 'paid' ? money(me.E, { whole: true }) : me.status === 'credit' ? money(me.E) : money(left, { whole: left >= 100 }))));
      }),
      h('td.num', null, personStatus(L.people[r.id]))))),
    h('tfoot', null, h('tr', null, h('th', null, t('collect.rateRow')), keys.map(k => { const P = L.period(k); return h('td.num.small', null, P.E > 0 ? pct(P.C / P.E, { sign: false }) : '—'); }), h('td')))))),
  h('div.row', null,
    h('button.link-btn', { type: 'button', onclick: () => { ctx.setPref('matrixN', n + 6); ctx.render(); } }, t('collect.morePeriods')),
    hidden ? h('button.link-btn', { type: 'button', onclick: () => { ctx.setPref('matrixAll', !ctx.L.prefs.matrixAll); ctx.render(); } }, ctx.L.prefs.matrixAll ? t('collect.hideOld') : t('collect.showOld', { n: hidden })) : null),
  h('p.note', null, t('collect.matrixNote')));
}

/** 每人每期最近一次导出的明细 */
function lastExports(ctx) {
  const out = {};
  for (const e of Object.values(ctx.S.data.exports || {})) {
    if (e.deleted) continue;
    const k = e.residentId + '|' + e.period;
    if (!out[k] || e.createdAt > out[k].createdAt) out[k] = e;
  }
  return out;
}

const stat = (label, value, sub) => h('div.stat', null, h('span.stat-label', null, label), h('span.stat-value.num', null, value), h('span.stat-sub', null, sub));
const num = (label, v, note, strong) => h('div', null, h('dt', null, label), h('dd.num', null, strong ? h('b', null, typeof v === 'number' ? money(v) : v) : (typeof v === 'number' ? money(v) : v), note ? h('small.muted.block', null, note) : null));
