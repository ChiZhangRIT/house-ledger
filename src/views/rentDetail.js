// 一个租期的应收、收支及备注；列表不再重复铺开流水。
import { h, openSheet } from '../ui/dom.js';
import { t, money, date } from '../i18n.js';
import { rentPeriodsFor, rentPeriodSummary } from '../core/rent.js';
import { statusChip } from './parts.js';
import { openPayment, openAdjustment } from './money.js';
import { openRentPeriod, rentRange, deleteRentRecord } from './rentHistory.js';
import { recordNotes } from './notes.js';

export function rentPeriodStatus(summary) {
  if (summary.incomplete || summary.remaining == null) return statusChip('unknown', t('rent.incomplete'));
  if (summary.remaining > 0.005) return statusChip('warning', t('st.due', { amount: summary.remaining }));
  if (summary.remaining < -0.005) return statusChip('credit', t('rent.overpaid', { amount: -summary.remaining }));
  return statusChip('good', t('st.settled'));
}

export function openRentDetail(ctx, residentId, record) {
  const body = h('div.rent-detail');
  const draw = () => {
    const period = rentPeriodsFor(ctx.S, residentId, ctx.D.today).find(x => x.id === record.id);
    if (!period) { sheet.close(); return; }
    const summary = rentPeriodSummary(ctx.S, period);
    sheet.setTitle(rentRange(period));
    const stat = (label, value) => h('div', null, h('span.small.muted', null, label), h('div.rent-detail-value.num', null, value));
    const more = h('details.rent-more', null, h('summary', null, t('rent.more')),
      h('div.row', null,
        h('button.link-btn', { type: 'button', onclick: () => openPayment(ctx, { residentId, rentId: period.id, refund: true, onSave: draw }) }, t('rent.recordRefund')),
        h('button.link-btn', { type: 'button', onclick: () => openAdjustment(ctx, { residentId, rentId: period.id, onSave: draw }) }, t('rent.adjustments')),
        h('button.link-btn', { type: 'button', onclick: () => openRentPeriod(ctx, residentId, period, { onSave: draw }) }, t('rent.editCharge')),
        h('button.link-btn.danger', { type: 'button', onclick: () => deleteRentRecord(ctx, period, draw) }, t('rent.deleteRecord'))));
    const receipts = h('div.rent-transactions');
    for (const payment of [...summary.receipts].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))) {
      receipts.append(h('div.rent-transaction', null,
        h('div', null, h('div', null, payment.date ? date(payment.date, 'iso') : t('rent.receiptDatePending'), ' · ', t(payment.amount < 0 ? 'rent.refund' : 'rent.receipt')),
          h('div.small.muted', null, payment.method ? t('method.' + payment.method) : t('rent.methodPending'), payment.note ? ' · ' + payment.note : '')),
        h('span.num', null, payment.amount == null ? t('rent.amountMissing') : money(payment.amount)),
        h('button.link-btn', { type: 'button', onclick: () => openPayment(ctx, { residentId, payment, onSave: draw }) }, t('bill.edit'))));
    }
    if (!summary.receipts.length) receipts.append(h('p.muted', null, t('rent.noReceipts')));
    const adjustments = summary.adjustments.length ? h('details', null, h('summary', null, t('rent.adjustments')),
      summary.adjustments.map(a => h('div.rent-transaction', null, h('span', null, a.label), h('span.num', null, money(a.amount)),
        h('button.link-btn', { type: 'button', onclick: () => openAdjustment(ctx, { residentId, adjustment: a, onSave: draw }) }, t('bill.edit'))))) : null;
    const notes = recordNotes(ctx, 'rents', ctx.S.data.rents[period.id] || period, draw);
    body.replaceChildren(...[
      h('div.row', null, h('p.muted', null, ctx.S.data.residents[residentId].name), h('span.sp'), rentPeriodStatus(summary)),
      h('p.small.muted', null, t('rent.dueDate'), ' · ', period.dueDate ? date(period.dueDate, 'iso') : t('rent.datesPending')),
      h('div.rent-detail-summary', null,
        stat(t('ledger.charge'), money(summary.expected)), stat(t('rent.netReceived'), money(summary.net)),
        stat(t(summary.remaining < 0 ? 'rent.overpaidLabel' : 'collect.periodLeft'), summary.remaining == null ? '—' : money(Math.abs(summary.remaining)))),
      summary.refunded ? h('p.note', null, t('rent.receiptsBreakdown', { paid: summary.received, amount: summary.refunded })) : null,
      summary.adjustments.length ? h('p.note', null, t('rent.amountWithAdjustments', { diff: summary.extra, total: summary.expected == null ? '—' : money(summary.expected) })) : null,
      h('div.row', null, h('button.btn.primary', { type: 'button', onclick: () => openPayment(ctx, { residentId, rentId: period.id, onSave: draw }) }, t('rent.addReceipt')), more),
      h('h3', null, t('rent.periodTransactions')), receipts, adjustments,
      notes ? h('section', null, h('h3', null, t('form.note')), notes) : null].filter(Boolean));
  };
  const sheet = openSheet({ title: rentRange(record), wide: true, body, closeLabel: t('rent.close') });
  draw(); return sheet;
}
