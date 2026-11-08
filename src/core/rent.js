// 房租独立台账：约定租期、应收快照与实际到账各自保存。
import { buildLedger, rentCharge } from './ledger.js';
import { monthRange } from './analytics.js';
import { isISODate, addDays } from './dates.js';
import { isHistory, rentDates, completeRentDates, rentRef, scheduledPeriods, validateRentPeriod, rentTrackingStart } from './rentPeriods.js';

export function rentState(state) {
  return { ...state, data: { ...state.data, bills: {}, rents: {}, payments: Object.fromEntries(rentPayments(state).map(p => [p.id, p])), adjustments: {} } };
}
export function rentPeriodsFor(state, residentId, today) {
  const r = state.data.residents[residentId];
  if (!r || r.deleted || r.isOwner) return [];
  // 旧版 history 仅用于理解旧字段；来源不再决定能否编辑、收款或调整。
  const saved = Object.values(state.data.rents).filter(x => !x.deleted && x.residentId === residentId)
    .map(x => ({ ...x, ...rentDates(x), amount: isHistory(x) ? null : x.amount }));
  const drafts = scheduledPeriods(state, r, today).map(x => {
    const charge = rentCharge({ ...r, moveIn: x.periodStart, moveOut: addDays(x.periodEnd, 1) }, x.nominalKey, x.cycleDay, state.settings.prorate);
    return { ...x, amount: charge?.cents == null ? null : charge.cents / 100, prorated: charge?.prorated };
  });
  const key = x => x.periodStart || x.legacyDate || x.paidDate || x.dueDate || '';
  return [...saved, ...drafts].sort((a, b) => key(a).localeCompare(key(b)) || a.id.localeCompare(b.id));
}
export function buildRentLedger(state, today) {
  const rentItems = {};
  for (const r of Object.values(state.data.residents).filter(r => !r.deleted && !r.isOwner)) {
    rentItems[r.id] = rentPeriodsFor(state, r.id, today).filter(x => state.data.rents[x.id] || x.dueDate <= today || x.periodStart <= today).map(x => ({
      ref: rentRef(x.id), rentId: x.id, type: 'rent', period: x.periodStart || '', periodStart: x.periodStart, periodEnd: x.periodEnd,
      due: x.dueDate || '', date: x.periodStart || '', cents: typeof x.amount === 'number' ? Math.round(x.amount * 100) : null,
      unknown: x.amount == null, prorated: !!x.prorated,
    }));
  }
  const adjustments = Object.values(state.data.adjustments).filter(x => !x.deleted && x.purpose === 'rent');
  for (const a of adjustments) {
    const item = rentItems[a.residentId]?.find(x => x.rentId === a.rentId);
    if (item && !item.unknown) {
      item.cents += Math.round(a.amount * 100);
      (item.adjustments ||= []).push(a);
    }
  }
  const L = buildLedger(rentState(state), today, { rentItems, assignedOnly: true });
  for (const [id, p] of Object.entries(L.people)) {
    p.trackingNotStarted = !rentTrackingStart(state, state.data.residents[id]) && !p.items.some(x => x.type === 'rent');
    p.scheduleMissing = !(state.data.residents[id].rentSchedules || []).length && !p.items.some(x => x.type === 'rent');
    p.unassignedAdjustments = adjustments.filter(a => a.residentId === id && !p.items.some(x => x.rentId === a.rentId));
    p.unassignedPayments = p.payments.filter(x => !x.rentId || !p.items.some(i => i.rentId === x.rentId));
    p.incompletePeriods = rentPeriodsFor(state, id, today).filter(x => !completeRentDates(x));
  }
  return L;
}
const knownAmount = r => r.paid && typeof r.receivedAmount === 'number' && Number.isFinite(r.receivedAmount);
/** 旧记录内的收款确认作为同一租期的收款使用，不复制或改写原始数据。未知日期仍留空。 */
export function rentPayments(state) {
  const embedded = Object.values(state.data.rents).filter(r => !r.deleted && knownAmount(r))
    .map(r => ({ id: 'receipt:' + r.id, residentId: r.residentId, rentId: r.id, purpose: 'rent',
      amount: r.receivedAmount, date: isISODate(r.paidDate) ? r.paidDate : '', note: r.note, embeddedRentId: r.id }));
  return [...Object.values(state.data.payments).filter(p => !p.deleted && p.purpose === 'rent'), ...embedded];
}
export function rentReceipts(state) {
  const payments = rentPayments(state).filter(p => isISODate(p.date) && state.data.residents[p.residentId] && !state.data.residents[p.residentId].deleted && !state.data.residents[p.residentId].isOwner);
  const dates = payments.map(p => p.date.slice(0, 7)).sort();
  const months = dates.length ? monthRange(dates[0], dates.at(-1)) : [];
  return { months, values: months.map(k => Math.round(payments.filter(p => p.date.startsWith(k)).reduce((s, p) => s + p.amount, 0) * 100) / 100), payments };
}
export function rentRecordSummary(state, residentId) {
  const records = Object.values(state.data.rents).filter(r => {
    const person = state.data.residents[r.residentId];
    return !r.deleted && person && !person.deleted && !person.isOwner && (!residentId || r.residentId === residentId);
  }).sort((a, b) => (rentDates(b).periodStart || rentDates(b).legacyDate || b.paidDate || '').localeCompare(rentDates(a).periodStart || rentDates(a).legacyDate || a.paidDate || ''));
  return { records, missing: records.filter(r => isHistory(r) || r.amount == null || !completeRentDates(r) || (r.paid && (!knownAmount(r) || !isISODate(r.paidDate)))),
    total: Math.round(records.filter(knownAmount).reduce((s, r) => s + r.receivedAmount, 0) * 100) / 100 };
}
export function validateRentRecord(state, rec) {
  const error = validateRentPeriod(state, rec);
  if (error) return error;
  if (rec.receivedAmount != null && (typeof rec.receivedAmount !== 'number' || !Number.isFinite(rec.receivedAmount) || rec.receivedAmount < 0 || rec.receivedAmount > 1e7)) return 'amount';
  if (!rec.paid && rec.receivedAmount != null) return 'status';
  if (rec.paidDate && !isISODate(rec.paidDate)) return 'date';
  if (rec.amount != null && (typeof rec.amount !== 'number' || !Number.isFinite(rec.amount) || rec.amount < 0 || rec.amount > 1e7)) return 'amount';
  return null;
}
