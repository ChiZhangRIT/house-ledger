// 住户详情以租期组织，收款、退款与备注进入同一租期的明细。
import { h } from '../ui/dom.js';
import { t, money, date } from '../i18n.js';
import { rentOn } from '../core/ledger.js';
import { rentPeriodsFor, rentPeriodSummary } from '../core/rent.js';
import { avatar, emptyState, statusChip } from './parts.js';
import { rentStatus } from './tenants.js';
import { openPayment, openAdjustment } from './money.js';
import { openResident } from './residents.js';
import { recordNotes } from './notes.js';
import { openRentPeriod, rentRange } from './rentHistory.js';
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
  const list = h('div.rent-record-list');
  if (periods.length) list.append(h('div.rent-record-grid.rent-record-head', null, h('span', null, t('rent.coverageDates')),
    h('span.num', null, t('ledger.charge')), h('span.num', null, t('rent.netReceived')), h('span.rent-record-status', null, t('rent.paymentStatus'))));
  for (const period of [...periods].reverse()) {
    const summary = rentPeriodSummary(ctx.S, period);
    const cell = (label, value) => h('span.num', null, h('span.rent-mobile-label', null, label, ' '), value);
    list.append(h('button.rent-record-grid.rent-record-row', { type: 'button', onclick: () => openRentDetail(ctx, id, period) },
      h('span.rent-record-period', null, rentRange(period), h('span.small.muted.block', null, t('rent.dueDate'), ' · ', period.dueDate ? date(period.dueDate, 'iso') : t('rent.datesPending'))),
      cell(t('ledger.charge'), money(summary.expected)), cell(t('rent.netReceived'), summary.net == null ? t('rent.amountMissing') : money(summary.net)),
      h('span.rent-record-status', null, rentPeriodStatus(summary), ' ›')));
  }
  for (const payment of p.unassignedPayments) {
    list.append(h('button.rent-record-grid.rent-record-row', { type: 'button', onclick: () => openPayment(ctx, { residentId: id, payment }) },
      h('span.rent-record-period', null, t('rent.coverageLater'), h('span.small.muted.block', null, payment.date ? date(payment.date, 'iso') : t('rent.receiptDatePending'), ' · ', t(payment.amount < 0 ? 'rent.refund' : 'rent.receipt'))),
      h('span.num', null, '—'), h('span.num', null, payment.amount == null ? t('rent.amountMissing') : money(payment.amount)),
      h('span.rent-record-status', null, statusChip('unknown', t('rent.incomplete')), ' ›')));
  }
  if (!periods.length && !p.unassignedPayments.length) list.append(h('p.muted', null, t('rent.emptyRecords')));
  const more = h('details.rent-more', null, h('summary', null, t('rent.more')),
    h('button.link-btn', { type: 'button', onclick: () => openRentPeriod(ctx, id) }, t('rent.addUnpaidPeriod')));
  root.append(h('section.card', null, h('div.row', null, h('h2.section-h', null, t('rent.account')), h('span.sp'),
    h('button.btn.primary', { type: 'button', onclick: () => openPayment(ctx, { residentId: id }) }, '＋ ' + t('rent.record')), more), list,
    p.unassignedAdjustments.length ? h('details', null, h('summary', null, t('rent.unassignedAdjustments')),
      p.unassignedAdjustments.map(a => h('div.rent-transaction', null, h('span', null, a.label), h('span.num', null, money(a.amount)),
        h('button.link-btn', { type: 'button', onclick: () => openAdjustment(ctx, { residentId: id, adjustment: a }) }, t('bill.edit'))))) : null));
}
