// 房租独立台账。旧版未分类的收款保留，不擅自认作房租。
import { buildLedger } from './ledger.js';
import { monthRange } from './analytics.js';
import { isISODate } from './dates.js';
export function rentState(state) {
  const rentOnly = records => Object.fromEntries(Object.entries(records || {}).filter(([, x]) => x.purpose === 'rent'));
  const rents = Object.fromEntries(Object.entries(state.data.rents || {}).filter(([, x]) => !x.history));
  return { ...state, data: { ...state.data, bills: {}, rents, payments: rentOnly(state.data.payments), adjustments: rentOnly(state.data.adjustments) } };
}
export function buildRentLedger(state, today) { return buildLedger(rentState(state), today); }
export function rentReceipts(state) {
  const payments = Object.values(state.data.payments).filter(p => !p.deleted && p.purpose === 'rent');
  const dates = payments.map(p => p.date.slice(0, 7)).sort();
  const months = dates.length ? monthRange(dates[0], dates[dates.length - 1]) : [];
  return { months, values: months.map(k => Math.round(payments.filter(p => p.date.startsWith(k)).reduce((s, p) => s + p.amount, 0) * 100) / 100), payments };
}

/** 历史实收按房租所属月份保存；不把已付状态、应收金额或未知金额当作收入。 */
export function rentHistorySummary(state, residentId) {
  const records = Object.values(state.data.rents).filter(r => {
    const person = state.data.residents[r.residentId];
    return !r.deleted && person && !person.deleted && !person.isOwner && (!residentId || r.residentId === residentId);
  }).sort((a, b) => b.periodStart.localeCompare(a.periodStart));
  const known = r => r.paid && typeof r.receivedAmount === 'number' && Number.isFinite(r.receivedAmount);
  const dates = records.map(r => r.periodStart.slice(0, 7)).sort();
  const months = dates.length ? monthRange(dates[0], dates.at(-1)) : [];
  const values = months.map(k => {
    const rows = records.filter(r => r.periodStart.startsWith(k) && known(r));
    return rows.length ? Math.round(rows.reduce((s, r) => s + r.receivedAmount, 0) * 100) / 100 : null;
  });
  return { records, months, values, missing: records.filter(r => !known(r)),
    partial: months.map(k => records.some(r => r.periodStart.startsWith(k) && !known(r))),
    total: Math.round(records.filter(known).reduce((s, r) => s + r.receivedAmount, 0) * 100) / 100 };
}

export function validateHistoryRent(state, rec) {
  const person = state.data.residents[rec.residentId];
  if (!person || person.deleted || person.isOwner) return 'tenant';
  if (!isISODate(rec.periodStart)) return 'month';
  const month = rec.periodStart.slice(0, 7);
  if (state.settings.ledgerStart && month >= state.settings.ledgerStart) return 'activePeriod';
  if (rec.receivedAmount != null && (typeof rec.receivedAmount !== 'number' || !Number.isFinite(rec.receivedAmount) || rec.receivedAmount < 0 || rec.receivedAmount > 1e7)) return 'amount';
  if (!rec.paid && rec.receivedAmount != null) return 'status';
  if (rec.paidDate && !isISODate(rec.paidDate)) return 'date';
  if (Object.values(state.data.rents).some(r => !r.deleted && r.id !== rec.id && r.residentId === rec.residentId && r.periodStart.slice(0, 7) === month)) return 'duplicate';
  return null;
}
