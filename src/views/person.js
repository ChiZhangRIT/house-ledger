// 住户详情以租期组织，收款、退款与备注进入同一租期的明细。
import { h } from '../ui/dom.js';
import { t, money, date } from '../i18n.js';
import { rentOn } from '../core/ledger.js';
import { rentPeriodsFor, rentPeriodSummary } from '../core/rent.js';
import { avatar, emptyState, statusChip } from './parts.js';
import { rentStatus } from './tenants.js';
import { openPayment, openAdjustment, deleteRentPayment } from './money.js';
import { openResident } from './residents.js';
import { recordNotes } from './notes.js';
import { openRentPeriod, rentRange, deleteRentRecord } from './rentHistory.js';
import { openRentDetail, rentPeriodStatus } from './rentDetail.js';

export function render(root, ctx, [id]) {
  const r = ctx.S.data.residents[id];
  if (!r || r.deleted) { root.append(emptyState(t('res.notFound'))); return; }
  const p = ctx.D.ledger.people[id], rent = rentOn(r, ctx.D.today);
  root.append(h('a.back', { href: '#/tenants' }, '‹ ' + t('nav.tenants')));
  root.append(h('section.card', null, h('div.person-head-top', null, avatar(r),
    h('div', null, h('h2', null, r.name), h('div.small.muted', null, date(r.moveIn), ' – ', r.moveOut ? date(r.moveOut) : t('res.now'))),
    h('span.sp'), p ? rentStatus(p) : null),
    h('p', null, r.isOwner ? t('res.owner') : rent == null ? t('rent.monthlyUnknown') : t('res.rentNow', { amount: rent })),
    h('button.btn', { type: 'button', onclick: () => openResident(ctx, r) }, t('res.edit'))));
  const notes = recordNotes(ctx, 'residents', r);
  if (notes) root.append(h('details.card', null, h('summary', null, t('rent.residentNotes')), notes));
  if (!p) return;
  const periods = rentPeriodsFor(ctx.S, id, ctx.D.today);
  const rows = h('tbody');
  const transactions = payments => {
    const sorted = [...payments].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
    return [h('td.rent-receipt-dates', null, sorted.length ? sorted.map(payment => h('div.rent-receipt-line', null,
      payment.amount < 0 ? t('rent.refund') + ' · ' : '', payment.date ? date(payment.date, 'iso') : t('rent.receiptDatePending'))) : '—'),
    h('td', null, sorted.length ? sorted.map(payment => h('div.rent-receipt-line', null,
      payment.method ? t('method.' + payment.method) : t('rent.methodPending'))) : '—')];
  };
  for (const period of [...periods].reverse()) {
    const summary = rentPeriodSummary(ctx.S, period);
    const open = () => openRentDetail(ctx, id, period);
    rows.append(h('tr.rent-record-row', { onclick: e => { if (!e.target.closest('button')) open(); } },
      h('th', { scope: 'row' }, h('button.rent-record-open', { type: 'button', onclick: open }, rentRange(period),
        h('span.small.muted.block', null, t('rent.dueDate'), ' · ', period.dueDate ? date(period.dueDate, 'iso') : t('rent.datesPending')))),
      h('td.num', null, money(summary.expected)), h('td.num', null, summary.net == null ? t('rent.amountMissing') : money(summary.net)),
      transactions(summary.receipts), h('td.rent-record-status', null, rentPeriodStatus(summary)),
      h('td', null, h('button.link-btn.danger', { type: 'button', 'aria-label': t('rent.deleteRecord') + ' · ' + rentRange(period), onclick: () => deleteRentRecord(ctx, period) }, t('bill.delete')))));
  }
  for (const payment of p.unassignedPayments) {
    const open = () => openPayment(ctx, { residentId: id, payment });
    rows.append(h('tr.rent-record-row', { onclick: e => { if (!e.target.closest('button')) open(); } },
      h('th', { scope: 'row' }, h('button.rent-record-open', { type: 'button', onclick: open }, t('rent.coverageLater'))),
      h('td.num', null, '—'), h('td.num', null, payment.amount == null ? t('rent.amountMissing') : money(payment.amount)),
      transactions([payment]), h('td.rent-record-status', null, statusChip('unknown', t('rent.incomplete'))),
      h('td', null, h('button.link-btn.danger', { type: 'button', 'aria-label': t('rent.deleteRecord') + ' · ' + t('rent.coverageLater'), onclick: () => deleteRentPayment(ctx, payment) }, t('bill.delete')))));
  }
  const list = h('div.rent-record-list', { tabindex: '0', role: 'region', 'aria-label': t('rent.account') },
    h('table.rent-record-table', null, h('thead', null, h('tr', null,
      [t('rent.coverageDates'), t('ledger.charge'), t('rent.netReceived'), t('rent.receivedDate'), t('rent.paymentMethod'), t('rent.paymentStatus'), t('rent.actions')]
        .map((label, i) => h('th' + (i === 1 || i === 2 ? '.num' : ''), { scope: 'col' }, label)))), rows));
  if (!periods.length && !p.unassignedPayments.length) list.replaceChildren(h('p.muted', null, t('rent.emptyRecords')));
  const more = h('details.rent-more', null, h('summary', null, t('rent.more')),
    h('button.link-btn', { type: 'button', onclick: () => openRentPeriod(ctx, id) }, t('rent.addUnpaidPeriod')));
  root.append(h('section.card', null, h('div.row', null, h('h2.section-h', null, t('rent.account')), h('span.sp'),
    h('button.btn.primary', { type: 'button', onclick: () => openPayment(ctx, { residentId: id }) }, '＋ ' + t('rent.record')), more), list,
    p.unassignedAdjustments.length ? h('details', null, h('summary', null, t('rent.unassignedAdjustments')),
      p.unassignedAdjustments.map(a => h('div.rent-transaction', null, h('span', null, a.label), h('span.num', null, money(a.amount)),
        h('button.link-btn', { type: 'button', onclick: () => openAdjustment(ctx, { residentId: id, adjustment: a }) }, t('bill.edit'))))) : null));
}
