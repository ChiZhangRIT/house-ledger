// 房租日期与金额可独立补填；历史记录不产生当前欠款。
import { h, openSheet } from '../ui/dom.js';
import { t, money, date } from '../i18n.js';
import { newId } from '../core/store.js';
import { rentHistorySummary, validateHistoryRent } from '../core/rent.js';
import { rentDates, validateRentPeriod } from '../core/rentPeriods.js';
import { parseAmount } from '../ui/parse.js';
import { sourceNotes } from './notes.js';

export function rentRange(record) {
  const d = rentDates(record);
  return d.periodStart && d.periodEnd ? `${d.periodStart} – ${d.periodEnd}` : t('rent.datesPending');
}
export function historySection(ctx, residentId) {
  const { records } = rentHistorySummary(ctx.S, residentId);
  const section = h('section.card', null,
    h('div.row', null, h('h2.section-h', null, t('rent.history')), h('span.sp'),
      h('button.btn', { type: 'button', onclick: () => openHistoryRent(ctx, residentId) }, '＋ ' + t('rent.historyAdd'))),
    h('p.note', null, t('rent.historyHint')));
  if (!records.length) { section.append(h('p.muted', null, t('rent.historyEmpty'))); return section; }
  const rows = records.map(r => {
    const d = rentDates(r);
    return h('tr', null,
      h('th.date-cell', { scope: 'row' }, d.dueDate || t('rent.datesPending'), d.legacyDate && !(d.periodStart && d.periodEnd && d.dueDate) ? h('div.small.muted', null, t('rent.legacyDate', { date: d.legacyDate })) : null),
      h('td.date-cell', null, d.periodStart || '—'), h('td.date-cell', null, d.periodEnd || '—'),
      h('td', null, t(r.paid ? 'rent.paidConfirmed' : 'rent.unconfirmed')),
      h('td.num', null, r.receivedAmount == null ? t('rent.amountMissing') : money(r.receivedAmount)),
      h('td.date-cell', null, date(r.paidDate, 'iso')),
      h('td', null, r.note || '', sourceNotes(ctx.S, 'rents', r.id, false)),
      h('td', null, h('button.btn', { type: 'button', 'aria-label': t('rent.editPeriod') + ' · ' + (d.periodStart || d.legacyDate || r.id), onclick: () => openHistoryRent(ctx, residentId, r) }, t('bill.edit'))));
  });
  section.append(h('div.table-scroll', null, h('table.data-table.rent-table', null,
    h('thead', null, h('tr', null, ['rent.dueDate', 'rent.start', 'rent.end', 'rent.paymentStatus', 'rent.receivedAmount', 'rent.receivedDate', 'form.note', ''].map(k => h('th', null, k ? t(k) : '')))), h('tbody', null, rows))));
  return section;
}
export function openHistoryRent(ctx, residentId, record) { return openRentPeriod(ctx, residentId, record, { history: true }); }

export function openRentPeriod(ctx, residentId, record, { history = false, onSave } = {}) {
  const d = record ? rentDates(record) : {};
  const f = { periodStart: d.periodStart || '', periodEnd: d.periodEnd || '', dueDate: d.dueDate || '', paid: record?.paid ?? true,
    amount: (history ? record?.receivedAmount : record?.amount) ?? null, paidDate: record?.paidDate || '', note: record?.note || '' };
  let dirty = false;
  const err = h('p.err', { hidden: true });
  const field = (key, label) => h('label.field', null, h('span.field-label', null, t(label)), h('input', { type: 'date', value: f[key], oninput: e => { f[key] = e.target.value; dirty = true; } }));
  const save = () => {
    const current = record && ctx.S.data.rents[record.id];
    if (current && current.updatedAt !== record.updatedAt && !confirm(t(current.deleted ? 'form.deletedElsewhere' : 'form.changedElsewhere'))) return;
    const rec = { ...record, id: record?.id || 'rent_' + newId(), residentId, history, datesConfirmed: true,
      periodStart: f.periodStart || null, periodEnd: f.periodEnd || null, dueDate: f.dueDate || null,
      legacyDate: d.legacyDate || null, note: f.note.trim() };
    if (history) Object.assign(rec, { paid: f.paid, receivedAmount: f.amount, paidDate: f.paidDate || null });
    else rec.amount = f.amount;
    delete rec.deleted; delete rec.deletedAt;
    let error = history ? validateHistoryRent(ctx.S, rec) : validateRentPeriod(ctx.S, rec);
    if (!error && f.amount != null && (!Number.isFinite(f.amount) || f.amount < 0 || f.amount > 1e7)) error = 'amount';
    if (error) { err.textContent = t('rent.historyError.' + error); err.hidden = false; return; }
    ctx.put('rents', rec); dirty = false; sheet.close(); ctx.toast(t('res.saved')); onSave?.(rec);
  };
  const remove = () => {
    const confirmation = openSheet({ title: t('bill.delete'), body: h('p', null, t('rent.historyDeleteConfirm')),
      foot: [h('span.sp'), h('button.btn', { type: 'button', onclick: () => confirmation.close() }, t('cancel')),
        h('button.btn.danger', { type: 'button', onclick: () => {
          const prev = ctx.remove('rents', record.id); confirmation.close(); dirty = false; sheet.close();
          ctx.toast(t('rent.historyDeleted'), { action: t('undo'), onAction: () => ctx.put('rents', prev), ms: 10000 });
        } }, t('bill.delete'))] });
  };
  const sheet = openSheet({ title: t(history ? (record ? 'rent.historyEdit' : 'rent.historyAdd') : (record ? 'rent.editPeriod' : 'rent.customPeriod')), wide: true,
    body: h('form.form', { onsubmit: e => { e.preventDefault(); save(); } },
      h('p', null, ctx.S.data.residents[residentId].name),
      d.legacyDate ? h('p.note', null, t('rent.legacyDate', { date: d.legacyDate })) : null,
      field('dueDate', 'rent.dueDate'),
      h('div.field-row', null, field('periodStart', 'rent.start'), field('periodEnd', 'rent.end')),
      h('p.note', null, t(history ? 'rent.historyDatesHint' : 'rent.periodHint')),
      history ? h('label.check-line', null, h('input', { type: 'checkbox', checked: f.paid, onchange: e => { f.paid = e.target.checked; dirty = true; } }), h('span', null, t('rent.paidConfirmed'))) : null,
      h('label.field', null, h('span.field-label', null, t(history ? 'rent.receivedAmount' : 'ledger.charge')),
        h('input', { inputmode: 'decimal', value: f.amount ?? '', placeholder: t('rent.amountMissing'), oninput: e => { f.amount = e.target.value.trim() ? parseAmount(e.target.value) ?? NaN : null; dirty = true; } })),
      history ? field('paidDate', 'rent.receivedDateOptional') : null,
      h('label.field', null, h('span.field-label', null, t('form.note')), h('textarea', { rows: 2, value: f.note, oninput: e => { f.note = e.target.value; dirty = true; } })),
      err, h('button', { type: 'submit', hidden: true })),
    foot: [history && record ? h('button.btn.danger', { type: 'button', onclick: remove }, t('bill.delete')) : null, h('span.sp'),
      h('button.btn', { type: 'button', onclick: () => sheet.tryClose() }, t('cancel')), h('button.btn.primary', { type: 'button', onclick: save }, t('save'))].filter(Boolean),
    beforeClose: () => !dirty || confirm(t('form.discard')),
  });
  return sheet;
}
