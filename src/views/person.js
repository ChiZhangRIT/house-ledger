// 住户详情只展示房租；原表批注和历史打勾保留原样。
import { h } from '../ui/dom.js';
import { t, money, date } from '../i18n.js';
import { rentOn } from '../core/ledger.js';
import { avatar, emptyState } from './parts.js';
import { rentStatus } from './tenants.js';
import { openPayment, openAdjustment, openPeriodCell, periodLabel } from './money.js';
import { openResident } from './residents.js';
import { sourceNotes } from './notes.js';

export function render(root, ctx, [id]) {
  const D = ctx.D, r = ctx.S.data.residents[id];
  if (!r || r.deleted) { root.append(emptyState(t('res.notFound'))); return; }
  const p = D.ledger.people[id], rent = rentOn(r, D.today);
  root.append(h('a.back', { href: '#/tenants' }, '‹ ' + t('nav.tenants')));
  root.append(h('section.card', null, h('div.person-head-top', null, avatar(r),
    h('div', null, h('h2', null, r.name), h('div.small.muted', null, date(r.moveIn), ' – ', r.moveOut ? date(r.moveOut) : t('res.now'))),
    h('span.sp'), p ? rentStatus(p) : null),
    h('p', null, r.isOwner ? t('res.owner') : rent == null ? t('rent.monthlyUnknown') : t('res.rentNow', { amount: rent })),
    h('div.row', null, p ? h('button.btn.primary', { type: 'button', onclick: () => openPayment(ctx, { residentId: id }) }, t('rent.record')) : null,
      h('button.btn', { type: 'button', onclick: () => openResident(ctx, r) }, t('res.edit')))));
  const notes = sourceNotes(ctx.S, 'residents', id); if (notes) root.append(notes);
  if (p) {
    const keys = [...new Set(p.items.map(x => x.period))].sort().reverse();
    if (keys.length) root.append(h('section.card', null, h('h2.section-h', null, t('rent.account')),
      h('div.table-scroll', null, h('table.data-table', null,
        h('thead', null, h('tr', null, [t('rent.period'), t('ledger.charge'), t('ledger.paid'), t('collect.periodLeft')].map(x => h('th', null, x)))),
        h('tbody', null, keys.map(k => {
          const me = D.ledger.period(k).people[id];
          return h('tr', null, h('th', null, h('button.link-btn', { type: 'button', onclick: () => openPeriodCell(ctx, id, k) }, periodLabel(ctx, k))),
            h('td.num', null, me.unknown ? t('st.unknown') : money(me.E)), h('td.num', null, money(me.C)), h('td.num', null, me.unknown ? '—' : money(me.left)));
        }))))));
    if (p.payments.length) root.append(h('section.card', null, h('h2.section-h', null, t('rent.receipts')),
      h('table.data-table', null, h('tbody', null, [...p.payments].reverse().map(x => h('tr', null,
        h('th', null, date(x.date), h('div.small.muted', null, t('method.' + (x.method || 'other')), x.note ? ' · ' + x.note : '')),
        h('td.num', null, money(x.amount)), h('td', null, h('button.link-btn', { type: 'button', onclick: () => {
          if (confirm(t('pay.deleteConfirm'))) { const prev = ctx.remove('payments', x.id); ctx.toast(t('pay.deleted'), { action: t('undo'), onAction: () => ctx.put('payments', prev) }); }
        } }, t('bill.delete')))))))));
    root.append(h('details.card', null, h('summary', null, t('rent.adjustments')), h('p.note', null, t('rent.adjustmentsHint')),
      h('button.btn', { type: 'button', onclick: () => openAdjustment(ctx, { residentId: id }) }, t('adj.title'))));
  }
  const old = Object.values(ctx.S.data.rents).filter(x => !x.deleted && x.residentId === id && x.paid).sort((a, b) => b.periodStart.localeCompare(a.periodStart));
  if (old.length) root.append(h('section.card', null, h('h2.section-h', null, t('rent.originalHistory')), h('p.note', null, t('rent.ticksNote')),
    h('div.table-scroll', null, h('table.data-table', null, h('tbody', null, old.map(x => h('tr', null,
      h('th', null, date(x.periodStart, 'num')), h('td', null, '✓ ' + t('rent.confirmed')),
      h('td.num', null, typeof x.amount === 'number' ? money(x.amount) : t('rent.notRecorded')), h('td', null, sourceNotes(ctx.S, 'rents', x.id)))))))));
}
