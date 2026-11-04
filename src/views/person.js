// 住户详情：房租台账、收款和可补填的历史房租。
import { h } from '../ui/dom.js';
import { t, money, date } from '../i18n.js';
import { rentOn } from '../core/ledger.js';
import { avatar, emptyState } from './parts.js';
import { rentStatus } from './tenants.js';
import { openPayment, openAdjustment } from './money.js';
import { openResident } from './residents.js';
import { sourceNotes } from './notes.js';
import { historySection, openRentPeriod, rentRange } from './rentHistory.js';
import { rentPeriodsFor } from '../core/rent.js';
import { rentTrackingStart } from '../core/rentPeriods.js';

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
  const notes = sourceNotes(ctx.S, 'residents', id, false); if (notes) root.append(h('section.card', null, notes));
  if (p) {
    const periods = rentPeriodsFor(ctx.S, id, D.today);
    const trackingStart = rentTrackingStart(ctx.S, r);
    root.append(h('section.card', null, h('div.row', null, h('h2.section-h', null, t('rent.account')), h('span.sp'),
      h('button.btn', { type: 'button', onclick: () => openRentPeriod(ctx, id) }, '＋ ' + t('rent.customPeriod'))),
      h('p.note', null, trackingStart ? t('rent.trackingSince', { date: date(trackingStart, 'iso') }) : t('rent.trackingSetup')),
      h('p.note', null, t('rent.periodHint')),
      periods.length ? h('div.table-scroll', null, h('table.data-table.rent-table', null,
        h('thead', null, h('tr', null, ['rent.dueDate', 'rent.start', 'rent.end', 'ledger.charge', 'ledger.paid', 'collect.periodLeft', ''].map(k => h('th', null, k ? t(k) : '')))),
        h('tbody', null, [...periods].reverse().map(x => {
          const debit = p.debits.find(d => d.rentId === x.id);
          const paid = p.payments.filter(pay => pay.rentId === x.id).reduce((sum, pay) => sum + pay.amount, 0);
          const item = p.items.find(i => i.rentId === x.id);
          const expected = item && !item.unknown ? item.cents / 100 : x.amount;
          const remaining = expected == null ? null : debit ? debit.remaining / 100 : Math.max(0, expected - paid);
          return h('tr', null, h('th.date-cell', null, x.dueDate), h('td.date-cell', null, x.periodStart), h('td.date-cell', null, x.periodEnd),
            h('td.num', null, expected == null ? t('st.unknown') : money(expected)), h('td.num', null, money(paid)), h('td.num', null, remaining == null ? '—' : money(remaining)),
            h('td', null, h('div.row', null, h('button.btn', { type: 'button', onclick: () => openRentPeriod(ctx, id, x) }, t('rent.editPeriod')),
              h('button.btn', { type: 'button', onclick: () => openPayment(ctx, { residentId: id, rentId: x.id }) }, t('rent.record')))));
        })))) : h('p.muted', null, t('rent.scheduleMissingHint'))));
    if (p.payments.length) root.append(h('section.card', null, h('h2.section-h', null, t('rent.receipts')),
      h('table.data-table.rent-table', null, h('tbody', null, [...p.payments].reverse().map(x => h('tr', null,
        h('th', null, date(x.date), h('div.small.muted', null, t('method.' + (x.method || 'other')), x.note ? ' · ' + x.note : ''), h('div.small', null, ctx.S.data.rents[x.rentId] && !ctx.S.data.rents[x.rentId].deleted ? rentRange(ctx.S.data.rents[x.rentId]) + ' · ' + t('rent.dueShort') + ' ' + ctx.S.data.rents[x.rentId].dueDate : t('rent.datesPending'))),
        h('td.num', null, money(x.amount)), h('td', null, h('div.row', null,
          h('button.btn', { type: 'button', onclick: () => openPayment(ctx, { payment: x }) }, t('bill.edit')),
          h('button.btn.danger', { type: 'button', onclick: () => {
          if (confirm(t('pay.deleteConfirm'))) { const prev = ctx.remove('payments', x.id); ctx.toast(t('pay.deleted'), { action: t('undo'), onAction: () => ctx.put('payments', prev) }); }
        } }, t('bill.delete'))))))))));
    root.append(h('details.card', null, h('summary', null, t('rent.adjustments')), h('p.note', null, t('rent.adjustmentsHint')),
      h('button.btn', { type: 'button', onclick: () => openAdjustment(ctx, { residentId: id }) }, t('adj.title')),
      Object.values(ctx.S.data.adjustments).filter(a => !a.deleted && a.purpose === 'rent' && a.residentId === id).map(a => h('p.small', null, a.label, ' · ', money(a.amount), ' · ', ctx.S.data.rents[a.rentId] ? rentRange(ctx.S.data.rents[a.rentId]) : t('rent.datesPending'), ' ', h('button.btn', { type: 'button', onclick: () => openAdjustment(ctx, { residentId: id, adjustment: a }) }, t('bill.edit'))))));
  }
  if (!r.isOwner) root.append(historySection(ctx, id));
}
