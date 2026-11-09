// 房租独立台账：约定租期、应收快照与实际到账各自保存。
import { buildLedger, rentCharge, rentOn } from './ledger.js';
import { monthRange } from './analytics.js';
import { isISODate, addDays, daysBetween } from './dates.js';
import { isHistory, rentDates, completeRentDates, rentRef, scheduledPeriods, validateRentPeriod, rentTrackingStart, validSchedule, monthDay, monthAfter } from './rentPeriods.js';

/** 按明确覆盖日期计算建议应收；不以入住、搬出或待收起点再次截短用户填写的区间。 */
export function calculateRentPeriod(resident, start, end, prorate = 'daily') {
  if (!isISODate(start) || !isISODate(end) || end < start) return { amount: null, reason: 'dates', parts: [] };
  const terms = (resident.rentSchedules || []).filter(validSchedule).sort((a, b) => a.from.localeCompare(b.from));
  const stop = addDays(end, 1), parts = [];
  let cursor = start, cents = 0;
  while (cursor < stop) {
    const term = terms.filter(x => x.from <= cursor).at(-1);
    if (!term) return { amount: null, reason: 'schedule', parts: [] };
    let key = cursor.slice(0, 7);
    if (cursor < monthDay(key, term.cycleDay)) key = monthAfter(key, -1);
    const cycleStart = monthDay(key, term.cycleDay), next = monthDay(monthAfter(key), term.cycleDay);
    const until = [stop, next, terms.find(x => x.from > cursor)?.from].filter(Boolean).sort()[0];
    const charge = rentCharge({ ...resident, moveIn: cursor, moveOut: until }, key, term.cycleDay, prorate);
    if (charge.unknown) return { amount: null, reason: 'rent', parts: [] };
    const cuts = [...new Set([cursor, ...(resident.rent || []).map(x => x.from).filter(x => x > cursor && x < until)])].sort();
    const rates = cuts.map((from, i) => ({ amount: rentOn(resident, from), days: daysBetween(from, cuts[i + 1] || until) }));
    parts.push({ cycleStart, cycleEnd: addDays(next, -1), days: charge.days, periodDays: charge.periodDays,
      amount: charge.cents / 100, full: prorate === 'full' && charge.days < charge.periodDays, rates });
    cents += charge.cents; cursor = until;
  }
  return { amount: cents / 100, parts };
}

export function rentState(state) {
  return { ...state, data: { ...state.data, bills: {}, rents: {}, payments: Object.fromEntries(rentPayments(state).filter(p => Number.isFinite(p.amount)).map(p => [p.id, p])), adjustments: {} } };
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
    const receipts = rentPayments(state).filter(x => x.residentId === id);
    p.unassignedPayments = receipts.filter(x => !x.rentId || !p.items.some(i => i.rentId === x.rentId));
    p.incompleteReceipts = receipts.filter(x => !Number.isFinite(x.amount));
    p.incompletePeriods = rentPeriodsFor(state, id, today).filter(x => !completeRentDates(x));
  }
  return L;
}
const knownAmount = r => r.paid && typeof r.receivedAmount === 'number' && Number.isFinite(r.receivedAmount);
/** 旧记录内的收款确认作为同一租期的收款使用，不复制或改写原始数据。未知日期仍留空。 */
export function rentPayments(state) {
  const embedded = Object.values(state.data.rents).filter(r => !r.deleted && r.paid && !state.data.payments['receipt:' + r.id])
    .map(r => ({ id: 'receipt:' + r.id, residentId: r.residentId, rentId: r.id, purpose: 'rent',
      amount: r.receivedAmount ?? null, date: isISODate(r.paidDate) ? r.paidDate : '', note: r.receiptNote || '',
      method: r.receiptMethod || '', embeddedRentId: r.id, confirmationOnly: !knownAmount(r), updatedAt: r.updatedAt }));
  return [...Object.values(state.data.payments).filter(p => !p.deleted && p.purpose === 'rent'), ...embedded];
}
/** 仅在用户编辑或删除旧收款时转换；固定 id 避免重导或同步时把同一笔钱统计两次。 */
export function rentReceiptChanges(state, payment) {
  const { embeddedRentId, ...receipt } = payment;
  const original = embeddedRentId && state.data.rents[embeddedRentId];
  return { receipt, rent: original ? { ...original, paid: false, receivedAmount: null, paidDate: null } : null };
}
/** 行级删除的快照：旧的内含收款随租期保存，独立收支按同一住户、同一租期收集。 */
export function rentRecordEntries(state, period) {
  return [['rents', state.data.rents[period.id] || period],
    ...['payments', 'adjustments'].flatMap(collection => Object.values(state.data[collection])
      .filter(x => !x.deleted && x.purpose === 'rent' && x.residentId === period.residentId && x.rentId === period.id)
      .map(x => [collection, x]))];
}
export function rentPeriodSummary(state, period) {
  const receipts = rentPayments(state).filter(x => x.residentId === period.residentId && x.rentId === period.id);
  const adjustments = Object.values(state.data.adjustments).filter(x => !x.deleted && x.purpose === 'rent' && x.residentId === period.residentId && x.rentId === period.id);
  const extra = adjustments.reduce((sum, x) => sum + Math.round(x.amount * 100), 0);
  const received = receipts.filter(x => x.amount > 0).reduce((sum, x) => sum + Math.round(x.amount * 100), 0);
  const refunded = receipts.filter(x => x.amount < 0).reduce((sum, x) => sum - Math.round(x.amount * 100), 0);
  const unknown = receipts.some(x => !Number.isFinite(x.amount));
  const expected = period.amount == null ? null : (Math.round(period.amount * 100) + extra) / 100;
  const net = unknown ? null : (received - refunded) / 100;
  return { receipts, adjustments, extra: extra / 100, received: received / 100, refunded: refunded / 100, expected, net,
    remaining: expected == null || net == null ? null : Math.round((expected - net) * 100) / 100,
    incomplete: !completeRentDates(period) || expected == null || unknown || receipts.some(x => !isISODate(x.date) && x.dateUnavailable !== true) };
}
export function rentReceipts(state) {
  const payments = rentPayments(state).filter(p => Number.isFinite(p.amount) && isISODate(p.date) && state.data.residents[p.residentId] && !state.data.residents[p.residentId].deleted && !state.data.residents[p.residentId].isOwner);
  const dates = payments.map(p => p.date.slice(0, 7)).sort();
  const months = dates.length ? monthRange(dates[0], dates.at(-1)) : [];
  return { months, values: months.map(k => Math.round(payments.filter(p => p.date.startsWith(k)).reduce((s, p) => s + p.amount, 0) * 100) / 100), payments };
}
export function rentRecordSummary(state, residentId) {
  const records = Object.values(state.data.rents).filter(r => {
    const person = state.data.residents[r.residentId];
    return !r.deleted && person && !person.deleted && !person.isOwner && (!residentId || r.residentId === residentId);
  }).sort((a, b) => (rentDates(b).periodStart || rentDates(b).legacyDate || b.paidDate || '').localeCompare(rentDates(a).periodStart || rentDates(a).legacyDate || a.paidDate || ''));
  const ids = new Set(records.map(r => r.id));
  return { records, missing: records.filter(r => rentPeriodSummary(state, { ...r, ...rentDates(r), amount: isHistory(r) ? null : r.amount }).incomplete),
    total: Math.round(rentPayments(state).filter(p => ids.has(p.rentId) && Number.isFinite(p.amount)).reduce((s, p) => s + p.amount, 0) * 100) / 100 };
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
