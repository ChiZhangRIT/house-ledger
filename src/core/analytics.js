// 统计：把账单换算成可以互相比较的数字。
// - 账单周期和自然月对不上（水费两个月一张），所以「每月花费」按服务周期的天数摊到每个自然月；
// - 每张账单也算「每天多少钱 / 每天用量」，和上一张、去年同期比较时不受周期长短影响；
// - 单价 = 那一项的金额 ÷ 用量（电 $/kWh、气 $/therm、水 $/CCF）。
// - 账单上印的结束日有两种：PG&E、AT&T、Xfinity 含结束日（下一张从第二天开始），市政和下一张共用边界日。
//   含结束日的账单 endInclusive = true，计算时结束日加一天，统一成半开区间 [开始, 结束)。
import { dayNumber, addDays, overlapDays } from './dates.js';
import { allocate, personDays } from './split.js';

/** 图表里的四大类，顺序固定（颜色跟着类别走） */
export const CATEGORIES = ['electricity', 'gas', 'water', 'internet'];

const ITEM_CATEGORY = {
  electric_delivery: 'electricity', electric_generation: 'electricity', electricity: 'electricity',
  gas: 'gas',
  water: 'water', sewer: 'water', garbage: 'water',
};
const PROVIDER_FALLBACK = { energy: 'electricity', water: 'water', internet: 'internet' };

/** 用量对应的分项（算单价用） */
export const USAGE_ITEMS = { electricity: ['electric_delivery', 'electric_generation'], gas: ['gas'], water: ['water'] };

const r2 = x => Math.round(x * 100) / 100;
export const monthKey = iso => iso.slice(0, 7);
export function nextMonth(key) {
  let [y, m] = key.split('-').map(Number);
  m += 1; if (m > 12) { m = 1; y += 1; }
  return `${y}-${String(m).padStart(2, '0')}`;
}
export function addMonths(key, n) {
  let [y, m] = key.split('-').map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String(t % 12 + 1).padStart(2, '0')}`;
}
export function monthRange(from, to) {
  const out = [];
  for (let k = from; k <= to && out.length < 1200; k = nextMonth(k)) out.push(k);
  return out;
}
export const monthDays = key => dayNumber(nextMonth(key) + '-01') - dayNumber(key + '-01');
/** 覆盖区间的结束日（不含） */
export const covEnd = b => (b.periodEnd && b.endInclusive ? addDays(b.periodEnd, 1) : b.periodEnd);
export const billDays = b => (b.periodStart && b.periodEnd ? dayNumber(covEnd(b)) - dayNumber(b.periodStart) : 0);

/** 一个分项属于哪一类：认识的 key 按表，不认识的按账单公司的类别 */
export function itemCategory(item, provider) {
  return ITEM_CATEGORY[item.key] || PROVIDER_FALLBACK[provider && provider.category] || 'internet';
}

/** 一张账单按类别拆开；分项加起来和总额对不上时，差额记到账单公司的默认类别 */
export function billCategoryAmounts(bill, provider) {
  const out = {};
  let sum = 0;
  for (const it of bill.items || []) {
    if (typeof it.amount !== 'number') continue;
    const c = itemCategory(it, provider);
    out[c] = (out[c] || 0) + it.amount;
    sum += it.amount;
  }
  const rest = r2((bill.total || 0) - sum);
  if (rest) { const c = PROVIDER_FALLBACK[provider && provider.category] || 'internet'; out[c] = (out[c] || 0) + rest; }
  for (const c of Object.keys(out)) out[c] = r2(out[c]);
  return out;
}

/** 把一段 [start, end) 里的数值按天数摊到每个自然月：返回 [[月份, 比例], ...] */
export function monthShares(start, end, fallbackIso) {
  const s = start && dayNumber(start), e = end && dayNumber(end);
  if (!(e > s)) return [[monthKey(fallbackIso || start || end), 1]];
  const out = [];
  for (let k = monthKey(start); ; k = nextMonth(k)) {
    const ms = dayNumber(k + '-01'), me = dayNumber(nextMonth(k) + '-01');
    const ov = Math.min(e, me) - Math.max(s, ms);
    if (ov > 0) out.push([k, ov / (e - s)]);
    if (me >= e) break;
  }
  return out;
}

/**
 * 每月花费（按服务周期摊到自然月）
 * @returns {{ months: string[], byCat: Record<string, number[]>, total: number[], complete: boolean[], coveredUntil: Record<string, string> }}
 *   complete[i] 为 false：这个月还有类别的账单没出（比如水费下个月才来），数字偏小
 */
export function monthlyCosts(bills, providersById) {
  const acc = {}, coveredUntil = {}, coveredFrom = {};
  let first = null, last = null;
  for (const b of bills) {
    if (b.deleted) continue;
    const p = providersById[b.providerId];
    const cats = billCategoryAmounts(b, p);
    for (const c of Object.keys(cats)) if (b.periodStart && (!coveredFrom[c] || b.periodStart < coveredFrom[c])) coveredFrom[c] = b.periodStart;
    for (const [k, f] of monthShares(b.periodStart, covEnd(b), b.statementDate)) {
      acc[k] = acc[k] || {};
      for (const [c, v] of Object.entries(cats)) acc[k][c] = (acc[k][c] || 0) + v * f;
      if (!first || k < first) first = k;
      if (!last || k > last) last = k;
    }
    const until = covEnd(b) || b.statementDate;
    for (const c of Object.keys(cats)) if (until && (!coveredUntil[c] || until > coveredUntil[c])) coveredUntil[c] = until;
  }
  const months = first ? monthRange(first, last) : [];
  const byCat = Object.fromEntries(CATEGORIES.map(c => [c, months.map(k => (acc[k] && acc[k][c] != null ? r2(acc[k][c]) : null))]));
  const total = months.map(k => (acc[k] ? r2(Object.values(acc[k]).reduce((a, v) => a + v, 0)) : null));
  const cats = Object.keys(coveredUntil);
  const minCovered = cats.length ? cats.map(c => coveredUntil[c]).sort()[0] : null;
  const maxFrom = cats.length ? cats.map(c => coveredFrom[c] || '').sort().pop() : null;   // 每一类都开始有账单之后的整月才算完整
  const complete = months.map(k => !!minCovered && nextMonth(k) + '-01' <= minCovered && (!maxFrom || k + '-01' >= maxFrom));
  return { months, byCat, total, complete, coveredUntil };
}

/** 每月用量（同样按天数摊到自然月） */
export function monthlyUsage(bills) {
  const acc = {}, units = {};
  let first = null, last = null;
  for (const b of bills) {
    if (b.deleted) continue;
    for (const u of b.usage || []) {
      if (typeof u.amount !== 'number') continue;
      units[u.key] = units[u.key] || u.unit;
      for (const [k, f] of monthShares(b.periodStart, covEnd(b), b.statementDate)) {
        acc[k] = acc[k] || {};
        acc[k][u.key] = (acc[k][u.key] || 0) + u.amount * f;
        if (!first || k < first) first = k;
        if (!last || k > last) last = k;
      }
    }
  }
  const months = first ? monthRange(first, last) : [];
  const byKey = Object.fromEntries(Object.keys(units).map(key => [key, months.map(k => (acc[k] && acc[k][key] != null ? Math.round(acc[k][key] * 10) / 10 : null))]));
  return { months, byKey, units };
}

/** 一张账单的天数、每天花费、每天用量、单价 */
export function billStats(bill) {
  const days = billDays(bill);
  const items = Object.fromEntries((bill.items || []).map(i => [i.key, i.amount]));
  const usage = {}, rates = {};
  for (const u of bill.usage || []) {
    if (typeof u.amount !== 'number') continue;
    usage[u.key] = { amount: u.amount, unit: u.unit, perDay: days > 0 ? u.amount / days : null };
    const keys = USAGE_ITEMS[u.key];
    if (keys && u.amount > 0) {
      const cost = keys.reduce((a, k) => a + (typeof items[k] === 'number' ? items[k] : 0), 0);
      // 金额 ≤ 0（比如气候补贴把这一项冲成负数）时单价没有意义，不算
      if (keys.some(k => typeof items[k] === 'number') && cost > 0) rates[u.key] = { value: cost / u.amount, unit: u.unit };
    }
  }
  return { days, perDay: days > 0 ? bill.total / days : null, usage, rates };
}

const mid = b => (dayNumber(b.periodStart) + dayNumber(covEnd(b))) / 2;
const pad2 = n => String(n).padStart(2, '0');
/** 平移整年（2/29 → 2/28） */
export function shiftYear(iso, n) {
  let [y, m, d] = iso.split('-').map(Number);
  y += n;
  if (m === 2 && d === 29) d = 28;
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

/**
 * 一段日期 [s, e) 的「虚拟账单」：把覆盖这段日期的账单按天数摊进来（金额、分项、用量都摊）。
 * 覆盖不到 minCover（默认 90%）时返回 null。
 */
export function rangeBill(bills, s, e, minCover = 0.9) {
  const len = dayNumber(e) - dayNumber(s);
  if (!(len > 0)) return null;
  let covered = 0, total = 0;
  const items = {}, usage = {}, units = {}, sources = [];
  for (const o of bills) {
    const D = billDays(o);
    if (o.deleted || !(D > 0)) continue;
    const ov = overlapDays(o.periodStart, covEnd(o), s, e);
    if (!ov) continue;
    const f = ov / D;
    covered += ov; total += (o.total || 0) * f; sources.push(o);
    for (const it of o.items || []) if (typeof it.amount === 'number') items[it.key] = (items[it.key] || 0) + it.amount * f;
    for (const u of o.usage || []) if (typeof u.amount === 'number') { usage[u.key] = (usage[u.key] || 0) + u.amount * f; units[u.key] = u.unit; }
  }
  if (covered < len * minCover) return null;
  const k = len / covered;    // 没覆盖到的几天按平均补齐
  return {
    id: '__range', pseudo: true, periodStart: s, periodEnd: e, endInclusive: false, total: r2(total * k),
    items: Object.entries(items).map(([key, a]) => ({ key, amount: r2(a * k) })),
    usage: Object.entries(usage).map(([key, a]) => ({ key, amount: Math.round(a * k * 100) / 100, unit: units[key] })),
    sources, coverage: covered / len,
  };
}

/**
 * 和上一张、去年同一段日期比较（传入同一类别的账单：网费换过公司也能接着比）。
 * 比较用「每天花费」，周期长短不同也能比。lastYear.bill 是摊出来的虚拟账单（pseudo），sources 是用到的账单。
 */
export function compareBill(bill, sameCategoryBills) {
  const list = sameCategoryBills.filter(b => !b.deleted && b.id !== bill.id && b.periodStart && b.periodEnd && billDays(b) > 0);
  if (!bill.periodStart || !bill.periodEnd || !(billDays(bill) > 0)) return { prev: null, lastYear: null };
  const m = mid(bill);
  const prev = list.filter(b => mid(b) < m).sort((a, b) => mid(b) - mid(a))[0] || null;
  const ly = rangeBill(list, shiftYear(bill.periodStart, -1), shiftYear(covEnd(bill), -1));
  const a = billStats(bill);
  const cmp = other => {
    if (!other) return null;
    const o = billStats(other);
    const pctf = (x, y) => (x != null && y ? (x - y) / Math.abs(y) : null);
    const usage = {}, rates = {};
    for (const [k, u] of Object.entries(a.usage)) if (o.usage[k]) usage[k] = pctf(u.perDay, o.usage[k].perDay);
    for (const [k, r] of Object.entries(a.rates)) if (o.rates[k]) rates[k] = pctf(r.value, o.rates[k].value);
    return { bill: other, perDay: o.perDay, perDayChange: pctf(a.perDay, o.perDay), usageChange: usage, rateChange: rates };
  };
  return { prev: cmp(prev), lastYear: cmp(ly) };
}

/**
 * 变化拆解：有用量的分项金额 = 天数 × 平均在住人数 × 人均日用量 × 单价，
 * 所以两期之比 = 四个比值相乘。返回每类用量各因素的变化（比值 − 1）。
 * residents 用来算平均在住加权人数（所有住户都算，包括主租客和不参与分摊的）。
 */
export function explainChange(bill, ref, residents) {
  if (!ref) return {};
  const heads = b => { const s = b.periodStart, e = covEnd(b), D = billDays(b); return D > 0 ? residents.reduce((a, r) => a + personDays(r, s, e), 0) / D : 0; };
  const A = billStats(bill), B = billStats(ref);
  const nA = heads(bill), nB = heads(ref), out = {};
  for (const k of Object.keys(A.rates)) {
    if (!B.rates[k] || !A.usage[k] || !B.usage[k]) continue;
    const costA = A.rates[k].value * A.usage[k].amount, costB = B.rates[k].value * B.usage[k].amount;
    if (!(costA > 0 && costB > 0 && nA > 0 && nB > 0)) continue;
    const eA = A.usage[k].amount / (nA * A.days), eB = B.usage[k].amount / (nB * B.days);
    out[k] = {
      cost: costA / costB - 1, days: A.days / B.days - 1, heads: nA / nB - 1,
      perCapita: eA / eB - 1, price: A.rates[k].value / B.rates[k].value - 1,
      perCapitaPerDay: { now: eA, before: eB, unit: A.usage[k].unit },
    };
  }
  return out;
}

/** 账单公司的类别：energy / water / internet（决定哪些住户参与分摊） */
export const splitCategory = provider => (provider && provider.category) || 'internet';

/**
 * 一张账单每户分多少。locked / manual：用存下来的金额；auto：按住户的入住日期、权重现算。
 * @returns {{ shares: Record<string, number>, mode: string, basis?: Array, fallback?: boolean }}
 */
export function billShares(bill, provider, residents) {
  const mode = (bill.allocation && bill.allocation.mode) || 'auto';
  if (mode !== 'auto' && bill.allocation.shares) return { shares: { ...bill.allocation.shares }, mode };
  const r = allocate({ ...bill, periodEnd: covEnd(bill) }, residents, splitCategory(provider));
  return { shares: r.shares, mode: 'auto', basis: r.basis, fallback: r.fallback, periodDays: r.periodDays };
}

/** 一年（或任意区间）的合计和平均：values 和 months 对齐，只算 complete 的月份 */
export function periodSummary(months, values, complete, fromKey, toKey) {
  let sum = 0, n = 0;
  months.forEach((k, i) => { if (k >= fromKey && k <= toKey && complete[i] && values[i] != null) { sum += values[i]; n++; } });
  return { sum: r2(sum), months: n, avg: n ? r2(sum / n) : null };
}

