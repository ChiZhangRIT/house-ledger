// 房租记录统一编辑；旧字段只为兼容已有记录，来源不影响功能。
import { h, openSheet } from '../ui/dom.js';
import { t, money } from '../i18n.js';
import { newId } from '../core/store.js';
import { validateRentRecord, calculateRentPeriod } from '../core/rent.js';
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
  let autoAmount = record?.amountAuto ?? (f.amount == null || !ctx.S.data.rents[record?.id]), amountInput;
  const err = h('p.err', { hidden: true });
  const field = (key, label) => h('label.field', null, h('span.field-label', null, t(label)), h('input', { type: 'date', value: f[key], oninput: e => {
    f[key] = e.target.value; dirty = true;
    if (key === 'periodStart' || key === 'periodEnd') refreshAmount();
  } }));
  const amountField = (key, label) => {
    const input = h('input', { inputmode: 'decimal', value: f[key] ?? '', placeholder: t('rent.amountMissing'), oninput: e => {
      f[key] = e.target.value.trim() ? parseAmount(e.target.value) ?? NaN : null; dirty = true;
      if (key === 'amount') { autoAmount = false; refreshAmount(); }
    } });
    if (key === 'amount') amountInput = input;
    return h('label.field', null, h('span.field-label', null, t(label)), input);
  };
  const expectedField = amountField('amount', 'rent.expectedAmount');
  const calculation = h('div'), amountMode = h('p.note'), adjustmentSummary = h('p.note');
  const useCalculated = h('button.link-btn', { type: 'button', onclick: () => { autoAmount = true; dirty = true; refreshAmount(); } }, t('rent.useCalculated'));
  function refreshAmount() {
    const result = calculateRentPeriod(ctx.S.data.residents[residentId], f.periodStart, f.periodEnd, ctx.S.settings.prorate);
    if (autoAmount) { f.amount = result.amount; amountInput.value = f.amount ?? ''; }
    amountMode.textContent = t(autoAmount ? 'rent.amountAuto' : 'rent.amountManual');
    amountMode.hidden = autoAmount && result.amount == null;
    calculation.replaceChildren(...(result.amount == null ? [h('p.note', null, t('rent.calculationMissing.' + result.reason))] : result.parts.map(p =>
      h('div', null, h('p.note', null, t('rent.calculationPeriod', { start: p.cycleStart, end: p.cycleEnd, days: p.periodDays, n: p.days })),
        h('p.small', null, p.full ? t('rent.calculationFull', { amount: p.amount })
          : [p.rates.map(r => t('rent.calculationRate', { rent: r.amount, n: r.days, days: p.periodDays })).join(' + ') + ' = ', h('strong', null, money(p.amount))])))));
    if (result.parts.length > 1) calculation.append(h('p.note', null, t('rent.calculationTotal', { amount: result.amount })));
    useCalculated.hidden = autoAmount || result.amount == null;
    const adjustments = record ? Object.values(ctx.S.data.adjustments).filter(x => !x.deleted && x.purpose === 'rent' && x.residentId === residentId && x.rentId === record.id) : [];
    const cents = adjustments.reduce((sum, x) => sum + Math.round(x.amount * 100), 0);
    adjustmentSummary.hidden = !adjustments.length;
    adjustmentSummary.textContent = Number.isFinite(f.amount)
      ? t('rent.amountWithAdjustments', { diff: cents / 100, total: (Math.round(f.amount * 100) + cents) / 100 }) : t('rent.adjustmentAmountMissing');
  }
  refreshAmount();
  const save = () => {
    const current = record && ctx.S.data.rents[record.id];
    if (current && current.updatedAt !== record.updatedAt && !confirm(t(current.deleted ? 'form.deletedElsewhere' : 'form.changedElsewhere'))) return;
    const rec = { ...record, id: record?.id || 'rent_' + newId(), residentId, history: false, datesConfirmed: true,
      periodStart: f.periodStart || null, periodEnd: f.periodEnd || null, dueDate: f.dueDate || null,
      legacyDate: d.legacyDate || null, amount: f.amount, amountAuto: autoAmount, paid: f.paid,
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
      h('p.note', null, t('rent.recordDatesHint')), expectedField,
      h('div.rent-period-preview', null, amountMode, calculation, useCalculated),
      h('p.note', null, t('rent.expectedHint')), adjustmentSummary,
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
