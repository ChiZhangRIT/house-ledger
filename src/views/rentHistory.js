// 独立的历史房租记录：可以补填实收，不产生当前台账的应收或收款。
import { h, openSheet } from '../ui/dom.js';
import { t, money, date, month } from '../i18n.js';
import { newId } from '../core/store.js';
import { cycleDay, prevPeriod } from '../core/ledger.js';
import { rentHistorySummary, validateHistoryRent } from '../core/rent.js';
import { parseAmount } from '../ui/parse.js';
import { sourceNotes } from './notes.js';

export function historySection(ctx, residentId) {
  const { records } = rentHistorySummary(ctx.S, residentId);
  const section = h('section.card', null,
    h('div.row', null, h('h2.section-h', null, t('rent.history')), h('span.sp'),
      h('button.btn', { type: 'button', onclick: () => openHistoryRent(ctx, residentId) }, '＋ ' + t('rent.historyAdd'))),
    h('p.note', null, t('rent.historyHint')));
  if (!records.length) { section.append(h('p.muted', null, t('rent.historyEmpty'))); return section; }
  section.append(h('div.table-scroll', null, h('table.data-table', null,
    h('thead', null, h('tr', null, [t('rent.month'), t('rent.paymentStatus'), t('rent.receivedAmount'), t('rent.receivedDate'), t('form.note'), ''].map(x => h('th', null, x)))),
    h('tbody', null, records.map(r => h('tr', null,
      h('th.date-cell', { scope: 'row' }, month(r.periodStart.slice(0, 7))),
      h('td', null, t(r.paid ? 'rent.paidConfirmed' : 'rent.unconfirmed')),
      h('td.num', null, r.receivedAmount == null ? t('rent.amountMissing') : money(r.receivedAmount)),
      h('td.date-cell', null, date(r.paidDate, 'iso')),
      h('td', null, r.note || '', sourceNotes(ctx.S, 'rents', r.id, false)),
      h('td', null, h('button.btn', { type: 'button', 'aria-label': t('rent.editMonth', { month: month(r.periodStart.slice(0, 7)) }), onclick: () => openHistoryRent(ctx, residentId, r) }, t('bill.edit')))))))));
  return section;
}

export function openHistoryRent(ctx, residentId, record) {
  const latestMonth = ctx.S.settings.ledgerStart ? prevPeriod(ctx.S.settings.ledgerStart) : ctx.D.today.slice(0, 7);
  const f = { month: record ? record.periodStart.slice(0, 7) : latestMonth, paid: record?.paid ?? true,
    amount: record?.receivedAmount ?? null, paidDate: record?.paidDate || '', note: record?.note || '' };
  let dirty = false;
  const err = h('p.err', { hidden: true });
  const fail = key => { err.textContent = t(key); err.hidden = false; };
  const amountInput = h('input', { inputmode: 'decimal', value: f.amount ?? '', placeholder: t('rent.amountMissing'),
    oninput: e => { f.amount = e.target.value.trim() ? parseAmount(e.target.value) ?? NaN : null; dirty = true; } });
  const save = () => {
    const current = record && ctx.S.data.rents[record.id];
    if (current && current.updatedAt !== record.updatedAt && !confirm(t(current.deleted ? 'form.deletedElsewhere' : 'form.changedElsewhere'))) return;
    const rec = { ...record, id: record?.id || 'rent_' + newId(), residentId, history: true,
      periodStart: record && record.periodStart.slice(0, 7) === f.month ? record.periodStart : `${f.month}-${String(cycleDay(ctx.S)).padStart(2, '0')}`,
      paid: f.paid, receivedAmount: f.amount, paidDate: f.paidDate || null, note: f.note.trim() };
    delete rec.deleted; delete rec.deletedAt;
    const error = validateHistoryRent(ctx.S, rec);
    if (error) return fail('rent.historyError.' + error);
    ctx.put('rents', rec); dirty = false; sheet.close(); ctx.toast(t('res.saved'));
  };
  const remove = () => {
    const confirmation = openSheet({ title: t('bill.delete'), body: h('p', null, t('rent.historyDeleteConfirm')),
      foot: [h('span.sp'), h('button.btn', { type: 'button', onclick: () => confirmation.close() }, t('cancel')),
        h('button.btn.danger', { type: 'button', onclick: () => {
          const prev = ctx.remove('rents', record.id);
          confirmation.close(); dirty = false; sheet.close();
          ctx.toast(t('rent.historyDeleted'), { action: t('undo'), onAction: () => ctx.put('rents', prev), ms: 10000 });
        } }, t('bill.delete'))] });
  };
  const sheet = openSheet({ title: t(record ? 'rent.historyEdit' : 'rent.historyAdd'),
    body: h('form.form', { onsubmit: e => { e.preventDefault(); save(); } },
      h('p', null, ctx.S.data.residents[residentId].name),
      h('label.field', null, h('span.field-label', null, t('rent.month')), h('input', { type: 'month', value: f.month, max: latestMonth, oninput: e => { f.month = e.target.value; dirty = true; } })),
      h('label.check-line', null, h('input', { type: 'checkbox', checked: f.paid, onchange: e => { f.paid = e.target.checked; dirty = true; } }), h('span', null, t('rent.paidConfirmed'))),
      h('label.field', null, h('span.field-label', null, t('rent.receivedAmount')), amountInput, h('span.hint', null, t('rent.amountHint'))),
      h('label.field', null, h('span.field-label', null, t('rent.receivedDateOptional')), h('input', { type: 'date', value: f.paidDate, oninput: e => { f.paidDate = e.target.value; dirty = true; } })),
      h('label.field', null, h('span.field-label', null, t('form.note')), h('textarea', { rows: 2, value: f.note, oninput: e => { f.note = e.target.value; dirty = true; } })),
      h('p.note', null, t('rent.historyHint')), err, h('button', { type: 'submit', hidden: true })),
    foot: [record ? h('button.btn.danger', { type: 'button', onclick: remove }, t('bill.delete')) : null, h('span.sp'),
      h('button.btn', { type: 'button', onclick: () => sheet.tryClose() }, t('cancel')), h('button.btn.primary', { type: 'button', onclick: save }, t('save'))].filter(Boolean),
    beforeClose: () => !dirty || confirm(t('form.discard')),
  });
}
