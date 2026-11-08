// 房租记录统一编辑；旧字段只为兼容已有记录，来源不影响功能。
import { h, openSheet } from '../ui/dom.js';
import { t } from '../i18n.js';
import { newId } from '../core/store.js';
import { validateRentRecord } from '../core/rent.js';
import { isHistory, rentDates } from '../core/rentPeriods.js';
import { parseAmount } from '../ui/parse.js';
import { sourceNotes } from './notes.js';

export function rentRange(record) {
  const d = rentDates(record);
  return d.periodStart && d.periodEnd ? `${d.periodStart} – ${d.periodEnd}`
    : t('rent.datesPending') + (d.legacyDate || record.paidDate || d.dueDate ? ' · ' + (d.legacyDate || record.paidDate || d.dueDate) : '');
}

export function openRentPeriod(ctx, residentId, record, { onSave } = {}) {
  const d = record ? rentDates(record) : {};
  const f = { periodStart: d.periodStart || '', periodEnd: d.periodEnd || '', dueDate: d.dueDate || '',
    amount: record && !isHistory(record) ? record.amount ?? null : null,
    paid: record?.paid ?? false, receivedAmount: record?.receivedAmount ?? null, paidDate: record?.paidDate || '', note: record?.note || '' };
  let dirty = false;
  const err = h('p.err', { hidden: true });
  const field = (key, label) => h('label.field', null, h('span.field-label', null, t(label)), h('input', { type: 'date', value: f[key], oninput: e => { f[key] = e.target.value; dirty = true; } }));
  const amountField = (key, label) => h('label.field', null, h('span.field-label', null, t(label)),
    h('input', { inputmode: 'decimal', value: f[key] ?? '', placeholder: t('rent.amountMissing'), oninput: e => { f[key] = e.target.value.trim() ? parseAmount(e.target.value) ?? NaN : null; dirty = true; } }));
  const save = () => {
    const current = record && ctx.S.data.rents[record.id];
    if (current && current.updatedAt !== record.updatedAt && !confirm(t(current.deleted ? 'form.deletedElsewhere' : 'form.changedElsewhere'))) return;
    const rec = { ...record, id: record?.id || 'rent_' + newId(), residentId, history: false, datesConfirmed: true,
      periodStart: f.periodStart || null, periodEnd: f.periodEnd || null, dueDate: f.dueDate || null,
      legacyDate: d.legacyDate || null, amount: f.amount, paid: f.paid,
      receivedAmount: f.paid ? f.receivedAmount : null, paidDate: f.paid ? f.paidDate || null : null, note: f.note.trim() };
    delete rec.deleted; delete rec.deletedAt;
    const error = validateRentRecord(ctx.S, rec);
    if (error) { err.textContent = t('rent.historyError.' + error); err.hidden = false; return; }
    ctx.put('rents', rec); dirty = false; sheet.close(); ctx.toast(t('res.saved')); onSave?.(rec);
  };
  const remove = () => {
    const confirmation = openSheet({ title: t('bill.delete'), body: h('p', null, t('rent.recordDeleteConfirm')),
      foot: [h('span.sp'), h('button.btn', { type: 'button', onclick: () => confirmation.close() }, t('cancel')),
        h('button.btn.danger', { type: 'button', onclick: () => {
          const prev = ctx.S.data.rents[record.id] || record;
          ctx.batch(() => { if (!ctx.S.data.rents[record.id]) ctx.put('rents', record); ctx.remove('rents', record.id); });
          confirmation.close(); dirty = false; sheet.close();
          ctx.toast(t('rent.recordDeleted'), { action: t('undo'), onAction: () => ctx.put('rents', prev), ms: 10000 });
        } }, t('bill.delete'))] });
  };
  const receiptFields = h('div.form', { hidden: !f.paid },
    h('div.field-row', null, amountField('receivedAmount', 'rent.receivedAmount'), field('paidDate', 'rent.receivedDateOptional')),
    h('p.note', null, t('rent.initialReceiptHint')));
  const sheet = openSheet({ title: t(record ? 'rent.editRecord' : 'rent.addRecord'), wide: true,
    body: h('form.form', { onsubmit: e => { e.preventDefault(); save(); } },
      h('p', null, ctx.S.data.residents[residentId].name),
      d.legacyDate ? h('p.note', null, t('rent.legacyDate', { date: d.legacyDate })) : null,
      field('dueDate', 'rent.dueDate'),
      h('div.field-row', null, field('periodStart', 'rent.start'), field('periodEnd', 'rent.end')),
      h('p.note', null, t('rent.recordDatesHint')), amountField('amount', 'rent.expectedAmount'),
      h('fieldset', null, h('legend', null, t('rent.initialReceipt')),
        h('label.check-line', null, h('input', { type: 'checkbox', checked: f.paid, onchange: e => { f.paid = e.target.checked; dirty = true; receiptFields.hidden = !f.paid; } }), h('span', null, t('rent.paidConfirmed'))), receiptFields),
      h('label.field', null, h('span.field-label', null, t('form.note')), h('textarea', { rows: 2, value: f.note, oninput: e => { f.note = e.target.value; dirty = true; } })),
      record ? sourceNotes(ctx.S, 'rents', record.id, false) : null,
      err, h('button', { type: 'submit', hidden: true })),
    foot: [record ? h('button.btn.danger', { type: 'button', onclick: remove }, t('bill.delete')) : null, h('span.sp'),
      h('button.btn', { type: 'button', onclick: () => sheet.tryClose() }, t('cancel')), h('button.btn.primary', { type: 'button', onclick: save }, t('save'))].filter(Boolean),
    beforeClose: () => !dirty || confirm(t('form.discard')),
  });
  return sheet;
}
