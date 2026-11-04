// 房租独立台账。旧版未分类的收款保留，不擅自认作房租。
import { buildLedger } from './ledger.js';
import { monthRange } from './analytics.js';
export function rentState(state) {
  const rentOnly = records => Object.fromEntries(Object.entries(records || {}).filter(([, x]) => x.purpose === 'rent'));
  return { ...state, data: { ...state.data, bills: {}, payments: rentOnly(state.data.payments), adjustments: rentOnly(state.data.adjustments) } };
}
export function buildRentLedger(state, today) { return buildLedger(rentState(state), today); }
export function rentReceipts(state) {
  const payments = Object.values(state.data.payments).filter(p => !p.deleted && p.purpose === 'rent');
  const dates = payments.map(p => p.date.slice(0, 7)).sort();
  const months = dates.length ? monthRange(dates[0], dates[dates.length - 1]) : [];
  return { months, values: months.map(k => Math.round(payments.filter(p => p.date.startsWith(k)).reduce((s, p) => s + p.amount, 0) * 100) / 100), payments };
}
