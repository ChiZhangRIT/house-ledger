// 各 Utility 独立取分项、用量和服务期，不合并不同单位。
import { dayNumber, addDays } from './dates.js';
import { shiftYear } from './analytics.js';
export const UTILITIES = ['electricity', 'gas', 'water', 'sewer', 'garbage', 'internet'];
export const UTILITY_INFO = {
  electricity: { category: 'energy', items: ['electric_delivery', 'electric_generation', 'electricity'], unit: 'kWh', color: 'var(--c-electricity)' },
  gas: { category: 'energy', items: ['gas'], unit: 'therm', color: 'var(--c-gas)' },
  water: { category: 'water', items: ['water'], unit: 'CCF', color: 'var(--c-water)' },
  sewer: { category: 'water', items: ['sewer'], color: 'var(--c-sewer)' },
  garbage: { category: 'water', items: ['garbage'], color: 'var(--c-garbage)' },
  internet: { category: 'internet', color: 'var(--c-internet)' },
};

// 分项允许负数抵扣；未分项的差额单列，不擅自归入某种费用。
export function billCostSeries(bills) {
  const labels = new Map();
  for (const b of bills) for (const i of b.items || []) labels.set(i.key || 'other', i.label || i.key);
  const byBill = bills.map(b => {
    const values = {};
    for (const i of b.items || []) values[i.key || 'other'] = (values[i.key || 'other'] || 0) + Math.round(i.amount * 100);
    const rest = Math.round(b.total * 100) - Object.values(values).reduce((s, v) => s + v, 0);
    if (rest) { values.unallocated = rest; labels.set('unallocated', 'Unallocated'); }
    return values;
  });
  return [...labels].map(([key, label]) => ({ key, label, values: byBill.map(v => v[key] == null ? null : v[key] / 100) }));
}

export function utilityRows(bills, providers, key, sourcePeriods = {}) {
  const info = UTILITY_INFO[key];
  return bills.filter(b => !b.deleted && providers[b.providerId]?.category === info.category).map(b => {
    const parts = (b.items || []).filter(i => info.items?.includes(i.key));
    const amount = key === 'internet' ? b.total : parts.length ? Math.round(parts.reduce((s, i) => s + i.amount, 0) * 100) / 100 : null;
    const usage = (b.usage || []).find(u => u.key === key);
    const p = b.itemPeriods?.[key] || sourcePeriods[b.id]?.items?.[key];
    // 总服务期来自水表，不能冒充污水和垃圾的独立周期。
    const missing = ['sewer', 'garbage'].includes(key) && !p;
    const start = p?.periodStart || (missing ? null : b.periodStart), end = p?.periodEnd || (missing ? null : b.periodEnd);
    const exclusive = end && !p && b.endInclusive ? addDays(end, 1) : end;
    const days = start && exclusive ? dayNumber(exclusive) - dayNumber(start) : null;
    return { bill: b, amount, usage: usage?.amount ?? null, unit: info.unit, start, end, endExclusive: exclusive, days,
      perDay: days > 0 && amount != null ? amount / days : null,
      usagePerDay: days > 0 && usage ? usage.amount / days : null };
  }).sort((a, b) => a.bill.statementDate.localeCompare(b.bill.statementDate));
}

// 去年相同服务日期的日均值。跨账单按实际覆盖天数折算；缺口或重叠不补齐、不重复计算。
export function utilityYearComparison(row, rows) {
  if (!(row.days > 0)) return null;
  const start = shiftYear(row.start, -1), endExclusive = shiftYear(row.endExclusive, -1);
  const from = dayNumber(start), to = dayNumber(endExclusive), days = to - from;
  if (!(days > 0)) return null;
  let cursor = from, cost = 0, usage = 0, costKnown = true, usageKnown = true;
  for (const r of [...rows].filter(r => r.bill.id !== row.bill.id && r.days > 0).sort((a, b) => a.start.localeCompare(b.start))) {
    const a = Math.max(from, dayNumber(r.start)), b = Math.min(to, dayNumber(r.endExclusive));
    if (a >= b) continue;
    if (a !== cursor) return null;
    cursor = b;
    if (r.amount == null) costKnown = false; else cost += r.amount * (b - a) / r.days;
    if (r.usage == null) usageKnown = false; else usage += r.usage * (b - a) / r.days;
  }
  if (cursor !== to) return null;
  const perDay = costKnown ? cost / days : null, usagePerDay = usageKnown ? usage / days : null;
  const change = (now, before) => now != null && before != null && before !== 0 ? (now - before) / Math.abs(before) : null;
  return { start, end: shiftYear(row.end, -1), endExclusive, days, perDay, usagePerDay,
    costChange: change(row.perDay, perDay), usageChange: change(row.usagePerDay, usagePerDay) };
}
