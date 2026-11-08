// 房租记录统一编辑；旧字段只为兼容已有记录，来源不影响功能。
import { h, openSheet, signButton } from '../ui/dom.js';
import { t, money } from '../i18n.js';
import { newId } from '../core/store.js';
import { validateRentRecord, calculateRentPeriod, rentRecordEntries } from '../core/rent.js';
import { isHistory, rentDates } from '../core/rentPeriods.js';
import { parseAmount } from '../ui/parse.js';

export function rentRange(record) {
  const d = rentDates(record);
  return d.periodStart && d.periodEnd ? `${d.periodStart} – ${d.periodEnd}`
    : t('rent.datesPending') + (d.legacyDate || record.paidDate || d.dueDate ? ' · ' + (d.legacyDate || record.paidDate || d.dueDate) : '');
}

export function openRentPeriod(ctx, residentId, record, { onSave } = {}) {
  const d = record ? rentDates(record) : {};
  const f = { periodStart: d.periodStart || '', periodEnd: d.periodEnd || '', dueDate: d.dueDate || '',
    amount: record && !isHistory(record) ? record.amount ?? null : null, note: record?.note || '' };
  let dirty = false;
  let autoAmount = record?.amountAuto ?? (f.amount == null || !ctx.S.data.rents[record?.id]), amountInput;
  const adjustments = record ? Object.values(ctx.S.data.adjustments)
    .filter(x => !x.deleted && x.purpose === 'rent' && x.residentId === residentId && x.rentId === record.id)
    .map(x => ({ original: x, kind: x.kind || 'other', amount: x.amount, label: x.label || '', removed: false })) : [];
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
  const calculation = h('div'), amountMode = h('p.note'), adjustmentSummary = h('div.row.rent-final-charge');
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
    const cents = adjustments.filter(x => !x.removed && Number.isFinite(x.amount)).reduce((sum, x) => sum + Math.round(x.amount * 100), 0);
    adjustmentSummary.replaceChildren(h('span', null, t('rent.finalExpected')), h('span.sp'),
      h('strong.num', null, Number.isFinite(f.amount) ? money((Math.round(f.amount * 100) + cents) / 100) : '—'));
  }
  refreshAmount();
  const adjustmentRows = h('div.form');
  const renderAdjustments = () => adjustmentRows.replaceChildren(...adjustments.filter(x => !x.removed).map(item => {
    const amount = h('input', { inputmode: 'decimal', value: item.amount ?? '', placeholder: '0.00', oninput: e => {
      item.amount = parseAmount(e.target.value); dirty = true; refreshAmount();
    } });
    item.amountInput = amount;
    const label = h('input', { value: item.label, oninput: e => { item.label = e.target.value; dirty = true; } });
    item.labelInput = label;
    return h('fieldset.rent-charge-item', null, h('div.field-row', null,
      h('label.field', null, h('span.field-label', null, t('adj.kind')), h('select', { onchange: e => {
        item.kind = e.target.value;
        if (Number.isFinite(item.amount) && ['charge', 'discount', 'writeoff'].includes(item.kind)) {
          item.amount = Math.abs(item.amount) * (item.kind === 'charge' ? 1 : -1); amount.value = item.amount;
        }
        dirty = true; refreshAmount();
      } }, ['charge', 'discount', 'opening', 'writeoff', 'other'].map(kind => h('option', { value: kind, selected: kind === item.kind }, t('adj.kind.' + kind))))),
      h('label.field', null, h('span.field-label', null, t('pay.amount')), h('div.amt-line', null, amount, signButton(amount)))),
      h('label.field', null, h('span.field-label', null, t('adj.label')), label),
      h('button.link-btn.danger', { type: 'button', onclick: () => { item.removed = true; dirty = true; renderAdjustments(); refreshAmount(); } }, t('rent.removeChargeItem')));
  }));
  const chargeDetails = h('details.rent-charge-editor', { open: adjustments.length > 0 }, h('summary', null, t('rent.chargeOptional')),
    h('div.form', null, adjustmentRows, h('button.btn', { type: 'button', onclick: () => {
      adjustments.push({ kind: 'charge', amount: null, label: '', removed: false }); dirty = true; renderAdjustments();
    } }, '＋ ' + t('rent.addChargeItem')), h('p.note', null, t('rent.chargeDraftHint'))));
  renderAdjustments();
  const save = () => {
    const current = record && ctx.S.data.rents[record.id];
    if (current && current.updatedAt !== record.updatedAt && !confirm(t(current.deleted ? 'form.deletedElsewhere' : 'form.changedElsewhere'))) return;
    const rec = { ...(current || record), id: record?.id || 'rent_' + newId(), residentId, history: false, datesConfirmed: true,
      periodStart: f.periodStart || null, periodEnd: f.periodEnd || null, dueDate: f.dueDate || null,
      legacyDate: d.legacyDate || null, amount: f.amount, amountAuto: autoAmount, note: f.note.trim() };
    delete rec.deleted; delete rec.deletedAt;
    const error = validateRentRecord(ctx.S, rec);
    if (error) { err.textContent = t('rent.historyError.' + error); err.hidden = false; return; }
    for (const item of adjustments.filter(x => !x.removed)) {
      if (!Number.isFinite(item.amount) || !item.amount || Math.abs(item.amount) > 1e7) {
        err.textContent = t('pay.badAmount'); err.hidden = false; chargeDetails.open = true; item.amountInput.focus(); return;
      }
      if (!item.label.trim()) { err.textContent = t('adj.needLabel'); err.hidden = false; chargeDetails.open = true; item.labelInput.focus(); return; }
    }
    const changed = adjustments.filter(x => x.original ? x.removed || x.kind !== (x.original.kind || 'other') || x.amount !== x.original.amount || x.label !== (x.original.label || '') : !x.removed);
    if (changed.some(x => x.original && ctx.S.data.adjustments[x.original.id]?.updatedAt !== x.original.updatedAt) && !confirm(t('form.changedElsewhere'))) return;
    ctx.batch(() => {
      ctx.put('rents', rec);
      for (const item of changed) {
        if (item.removed) ctx.remove('adjustments', item.original.id);
        else ctx.put('adjustments', { ...item.original, id: item.original?.id || 'adj_' + newId(), purpose: 'rent', residentId, rentId: rec.id,
          date: item.original?.date || ctx.D.today, amount: item.amount, kind: item.kind, label: item.label.trim(),
          collectPeriod: (rec.periodStart || rec.legacyDate || rec.paidDate || rec.dueDate || ctx.D.today).slice(0, 7) });
      }
    });
    dirty = false; sheet.close(); ctx.toast(t('res.saved')); onSave?.(rec);
  };
  const remove = () => deleteRentRecord(ctx, record, () => { dirty = false; sheet.close(); onSave?.(); });
  const sheet = openSheet({ title: t(record ? 'rent.editCharge' : 'rent.newPeriod'), closeLabel: t('rent.close'), wide: true,
    body: h('form.form', { onsubmit: e => { e.preventDefault(); save(); } },
      h('p', null, ctx.S.data.residents[residentId].name),
      d.legacyDate ? h('p.note', null, t('rent.legacyDate', { date: d.legacyDate })) : null,
      field('dueDate', 'rent.dueDate'),
      h('div.field-row', null, field('periodStart', 'rent.start'), field('periodEnd', 'rent.end')),
      h('p.note', null, t('rent.recordDatesHint')), expectedField,
      h('div.rent-period-preview', null, amountMode, calculation, useCalculated),
      h('p.note', null, t('rent.expectedHint')), chargeDetails, adjustmentSummary,
      h('label.field', null, h('span.field-label', null, t('form.note')), h('textarea', { rows: 2, value: f.note, oninput: e => { f.note = e.target.value; dirty = true; } })),
      err, h('button', { type: 'submit', hidden: true })),
    foot: [record ? h('button.btn.danger', { type: 'button', onclick: remove }, t('rent.deleteRecord')) : null, h('span.sp'),
      h('button.btn', { type: 'button', onclick: () => sheet.tryClose() }, t('cancel')), h('button.btn.primary', { type: 'button', onclick: save }, t('save'))].filter(Boolean),
    beforeClose: () => !dirty || confirm(t('form.discard')),
  });
  return sheet;
}

/** 删除整行，包括只属于这一租期的收支；完整快照可撤销或从最近删除恢复。 */
export function deleteRentRecord(ctx, record, onChange) {
  const confirmation = openSheet({ title: t('rent.deleteRecord'), closeLabel: t('rent.close'), body: h('div', null,
    h('p', null, rentRange(record)), h('p', null, t('rent.rowDeleteConfirm'))),
    foot: [h('span.sp'), h('button.btn', { type: 'button', onclick: () => confirmation.close() }, t('cancel')),
      h('button.btn.danger', { type: 'button', onclick: () => {
        const entries = rentRecordEntries(ctx.S, record);
        ctx.batch(() => {
          for (const [collection, entry] of entries) {
            if (!ctx.S.data[collection][entry.id]) ctx.put(collection, entry);
            ctx.remove(collection, entry.id);
          }
        });
        confirmation.close(); onChange?.();
        ctx.toast(t('rent.recordDeleted'), { action: t('undo'), onAction: () => {
          ctx.batch(() => { for (const [collection, entry] of entries) ctx.put(collection, entry); });
          onChange?.();
        }, ms: 10000 });
      } }, t('bill.delete'))] });
}
