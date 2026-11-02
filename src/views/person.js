// 个人台账：抬头（在住、权重、参与方式、房租、余额）、流水（逐行累计余额）、按期、开账前的历史
import { h } from '../ui/dom.js';
import { t, money, date, period } from '../i18n.js';
import { weightOn, participation } from '../core/split.js';
import { rentOn, periodRange } from '../core/ledger.js';
import { billShares } from '../core/analytics.js';
import { avatar, emptyState, providerOf } from './parts.js';
import { personStatus } from './overview.js';
import { openPayment, openAdjustment, openStatement, openPeriodCell, billLabel, periodLabel } from './money.js';
import { openResident } from './residents.js';

export function render(root, ctx, [id]) {
  const D = ctx.D, r = Object.prototype.hasOwnProperty.call(ctx.S.data.residents, id) ? ctx.S.data.residents[id] : null;
  if (!r || r.deleted) { root.append(emptyState(t('res.notFound'))); return; }
  const p = D.ledger.people[id];
  root.append(h('a.back', { href: '#/collect' }, '‹ ' + t('nav.collect')));
  const parts = ['energy', 'water', 'internet'].map(c => t('splitcat.' + c) + ' ' + t('part.' + participation(r, c))).join(' · ');
  const rent = rentOn(r, D.today);
  root.append(h('section.card.person-head', null,
    h('div.person-head-top', null, avatar(r),
      h('div', null, h('h2', null, r.name, r.isOwner ? h('span.badge', null, t('res.owner')) : null),
        h('div.muted.small', null, date(r.moveIn), ' – ', r.moveOut ? date(r.moveOut) : t('res.living'), ' · ', t('res.weightNow', { w: weightOn(r, D.today) }), rent != null ? ' · ' + t('res.rentNow', { amount: rent }) : ''),
        h('div.muted.small', null, parts)),
      h('span.sp'),
      p ? h('div.person-bal', null, h('div.big-num.num', null, money(p.balance)), personStatus(p)) : null),
    p ? h('div.actions', null,
      h('button.btn.primary', { type: 'button', onclick: () => openPayment(ctx, { residentId: id }) }, '＋ ' + t('pay.title')),
      h('button.btn', { type: 'button', onclick: () => openStatement(ctx, { residentId: id }) }, t('st.title')),
      h('button.btn', { type: 'button', onclick: () => openAdjustment(ctx, { residentId: id }) }, t('adj.title')),
      h('button.btn', { type: 'button', onclick: () => openResident(ctx, r) }, t('res.edit'))) : h('div.actions', null, h('button.btn', { type: 'button', onclick: () => openResident(ctx, r) }, t('res.edit')))));
  if (!p) { root.append(h('p.muted', null, t('res.ownerNoLedger'))); history(root, ctx, r); return; }

  // 流水
  const rows = [
    ...p.items.map(it => ({ date: it.date, kind: 'charge', it, amount: it.cents == null ? null : it.cents / 100 })),
    ...p.payments.map(x => ({ date: x.date, kind: 'pay', x, amount: -Number(x.amount) })),
  ].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.kind === 'charge' ? -1 : 1));
  let run = 0;
  const body = rows.map(row => {
    if (row.amount != null) run = Math.round((run + row.amount) * 100) / 100;
    const label = row.kind === 'pay' ? [t('ledger.payment'), ' · ', t('method.' + (row.x.method || 'other')), row.x.note ? ' · ' + row.x.note : '']
      : row.it.type === 'rent' ? [t('ledger.rentFor', { p: periodLabel(ctx, row.it.period) }), row.it.prorated ? ' · ' + t('ledger.prorated', { n: row.it.days, d: row.it.periodDays }) : '', row.it.unknown ? ' · ' + t('ledger.unknownRent') : '']
        : row.it.type === 'bill' ? h('a', { href: '#/bill/' + encodeURIComponent(row.it.billId) }, billLabel(ctx, row.it.billId)) : (row.it.label || t('adj.kind.other'));
    return h('tr', null, h('td', null, date(row.date, 'num')), h('th', null, label),
      h('td.num', null, row.kind === 'charge' ? (row.amount == null ? '—' : money(row.amount)) : ''),
      h('td.num', null, row.kind === 'pay' ? money(-row.amount) : ''),
      h('td.num', null, money(run)));
  });
  root.append(h('section.card', null, h('h2.section-h', null, t('ledger.flow')),
    rows.length ? h('div.table-scroll', null, h('table.data-table', null,
      h('thead', null, h('tr', null, h('th', null, t('ledger.date')), h('th', null, t('ledger.desc')), h('th.num', null, t('ledger.charge')), h('th.num', null, t('ledger.paid')), h('th.num', null, t('ledger.balance')))),
      h('tbody', null, body.reverse()))) : h('p.muted', null, t('ledger.nothing'))));

  // 按期
  const start = ctx.S.settings.ledgerStart;
  const keys = start ? periodRange(start, D.ledger.current).reverse().filter(k => (D.ledger.period(k).people[id] || {}).E) : [];
  if (keys.length) {
    root.append(h('section.card', null, h('h2.section-h', null, t('ledger.byPeriod')),
      h('table.data-table', null,
        h('thead', null, h('tr', null, h('th', null, t('form.collectPeriod')), h('th.num', null, t('collect.periodE')), h('th.num', null, t('collect.periodC')), h('th.num', null, t('collect.periodLeft')))),
        h('tbody', null, keys.map(k => { const me = D.ledger.period(k).people[id]; return h('tr', { onclick: () => openPeriodCell(ctx, id, k), class: 'clickable' },
          h('th', null, periodLabel(ctx, k)), h('td.num', null, money(me.E)), h('td.num', null, money(me.C)), h('td.num', null, money(me.left))); })))));
  }
  history(root, ctx, r);
}

/** 开账前的历史（从表格导入的分摊金额），只供查看 */
function history(root, ctx, r) {
  const D = ctx.D;
  const rows = D.bills.filter(b => !b.collectPeriod).map(b => ({ b, amt: billShares(b, providerOf(ctx, b), D.residents).shares[r.id] })).filter(x => x.amt);
  if (!rows.length) return;
  const sum = rows.reduce((a, x) => a + x.amt, 0);
  root.append(h('details.card', null, h('summary', null, t('ledger.history', { n: rows.length, amount: Math.round(sum * 100) / 100 })),
    h('p.note', null, t('ledger.historyNote')),
    h('table.data-table', null, h('tbody', null, rows.map(x => h('tr', null, h('td', null, date(x.b.statementDate, 'num')),
      h('th', null, h('a', { href: '#/bill/' + encodeURIComponent(x.b.id) }, billLabel(ctx, x.b.id))), h('td.num', null, money(x.amt))))))));
}
