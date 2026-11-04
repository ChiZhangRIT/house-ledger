// 收款账：房租和水电网放在同一本账里，按「收款期」对账。
// - 收款期：每月 rentCycleDay 号（默认 16）到下个月同一天的前一天，用 'YYYY-MM' 表示，[start, nextStart)。
// - 开账期 ledgerStart（'YYYY-MM'）：之前的期不计入收款（从表格导入的历史只用来统计，不生成欠款）。
// - 应收项（都是现算的，不存）：
//   · 房租：每户每期一条；金额 = rents 里这一期改过的金额，否则按住户的月租（residents[].rent = [{ from, amount }]），
//     入住、搬出那一期按天折算（设置 prorate = 'full' 时收整期）。没设月租的期记为「金额未知」，不计入余额。
//   · 账单份额：账单的 collectPeriod（跟下一次房租一起收）那一期，每户分到的金额。
//   · 调整：adjustments 集合（期初余额、减免、加收…），正数加收、负数减免。
// - 收款按「先到期先抵」冲抵；多出来的是预付，自动抵以后的应收。退款记为负数收款。
// - 主租客（isOwner）不在这本账里。
// 金额都换成整数分计算，避免小数误差。
import { live } from './store.js';
import { billShares } from './analytics.js';
import { dayNumber, addDays } from './dates.js';
import { monthDay, rentRef } from './rentPeriods.js';

const cents = x => Math.round((Number(x) || 0) * 100);
const dollars = c => c / 100;
const pad = n => String(n).padStart(2, '0');
const TYPE_ORDER = { opening: 0, rent: 1, bill: 2, adj: 3, refund: 4 };

export const cycleDay = state => Math.min(28, Math.max(1, Number(state.settings.rentCycleDay) || 16));
export const nextPeriod = key => { let [y, m] = key.split('-').map(Number); m += 1; if (m > 12) { m = 1; y += 1; } return `${y}-${pad(m)}`; };
export const prevPeriod = key => { let [y, m] = key.split('-').map(Number); m -= 1; if (m < 1) { m = 12; y -= 1; } return `${y}-${pad(m)}`; };
export const periodStart = (key, cd) => monthDay(key, cd);
export const periodEnd = (key, cd) => periodStart(nextPeriod(key), cd);       // 不含
/** 包含某天的那一期 */
export function periodOf(iso, cd) {
  const [y, m, d] = iso.split('-').map(Number);
  return d >= cd ? `${y}-${pad(m)}` : prevPeriod(`${y}-${pad(m)}`);
}
/** 账单份额默认计入哪一期：第一个开始日 ≥ max(账单日期, 今天) 的期，也就是跟下一次交房租一起收 */
export function defaultCollectPeriod(statementDate, todayIso, cd) {
  const from = statementDate > todayIso ? statementDate : todayIso;
  const k = periodOf(from, cd);
  return periodStart(k, cd) >= from ? k : nextPeriod(k);
}
export function periodRange(from, to) {
  const out = [];
  for (let k = from; k <= to && out.length < 1200; k = nextPeriod(k)) out.push(k);
  return out;
}

/** 某户在某天的月租 */
export function rentOn(resident, iso) {
  let amt = null;
  for (const x of [...(resident.rent || [])].sort((a, b) => (a.from < b.from ? -1 : 1))) if (x.from <= iso) amt = x.amount;
  return typeof amt === 'number' ? amt : null;
}

/**
 * 某户某期的房租（分）。返回 { cents, days, periodDays, prorated, unknown }；这期没住返回 null。
 * 月租在期中变了时按天分段算。
 */
export function rentCharge(resident, key, cd, prorate = 'daily') {
  const s = dayNumber(periodStart(key, cd)), e = dayNumber(periodEnd(key, cd)), D = e - s;
  const a = Math.max(s, dayNumber(resident.moveIn)), b = Math.min(e, resident.moveOut ? dayNumber(resident.moveOut) : Infinity);
  const n = Math.max(0, b - a);
  if (!n) return null;
  const startIso = periodStart(key, cd);
  if (n < D && prorate === 'full') {
    const m = rentOn(resident, addDays(startIso, a - s));       // 期中入住：按住进来那天的月租
    return { cents: m == null ? null : cents(m), days: n, periodDays: D, prorated: false, unknown: m == null };
  }
  // 按天累加：每天 = 当天的月租 ÷ 期天数
  const changes = (resident.rent || []).map(x => dayNumber(x.from)).filter(d => d > a && d < b);
  const cuts = [a, ...changes.sort((x, y) => x - y), b];
  let sum = 0, unknown = false;
  for (let i = 0; i + 1 < cuts.length; i++) {
    const iso = addDays(startIso, cuts[i] - s);
    const m = rentOn(resident, iso);
    if (m == null) { unknown = true; continue; }
    sum += cents(m) * (cuts[i + 1] - cuts[i]);
  }
  if (unknown) return { cents: null, days: n, periodDays: D, prorated: n < D, unknown: true };
  return { cents: Math.round(sum / D), days: n, periodDays: D, prorated: n < D || changes.length > 0, unknown: false };
}

/**
 * 每户的应收项
 * @returns {Record<string, Array<{ ref, type, period, due, date, cents, label?, billId?, adjId?, unknown? }>>}
 */
export function receivables(state, todayIso, D = {}) {
  const cd = cycleDay(state), start = state.settings.ledgerStart || null;
  const prorate = state.settings.prorate === 'full' ? 'full' : 'daily';
  const residents = D.residents || live(state, 'residents');
  const providers = state.data.providers;
  const out = {};
  for (const r of residents) if (!r.isOwner) out[r.id] = [];
  const overrides = {};
  for (const x of live(state, 'rents')) if (x.periodStart) overrides[x.residentId + '|' + x.periodStart.slice(0, 7)] = x;
  const cur = periodOf(todayIso, cd);
  // 房租
  if (D.rentItems) {
    for (const [rid, rows] of Object.entries(D.rentItems)) if (out[rid]) out[rid].push(...rows);
  } else if (start) {
    for (const r of residents) {
      if (r.isOwner || !r.moveIn) continue;
      const first = periodOf(r.moveIn, cd), last = r.moveOut ? periodOf(addDays(r.moveOut, -1), cd) : cur;
      for (const k of periodRange(first > start ? first : start, last < cur ? last : cur)) {
        const ov = overrides[r.id + '|' + k];
        let c;
        if (ov && typeof ov.amount === 'number') c = { cents: cents(ov.amount), override: true };
        else c = rentCharge(r, k, cd, prorate);
        if (!c) continue;
        out[r.id].push({ ref: `rent:${r.id}:${k}`, type: 'rent', period: k, due: periodStart(k, cd), date: periodStart(k, cd), cents: c.cents, unknown: c.cents == null, prorated: !!c.prorated, days: c.days, periodDays: c.periodDays, override: !!c.override });
      }
    }
  }
  // 账单份额
  for (const b of D.bills || live(state, 'bills')) {
    if (!b.collectPeriod || (start && b.collectPeriod < start)) continue;
    const { shares } = billShares(b, providers[b.providerId], residents);
    for (const [rid, amt] of Object.entries(shares)) {
      if (!out[rid] || !amt) continue;
      out[rid].push({ ref: `bill:${b.id}:${rid}`, type: 'bill', period: b.collectPeriod, due: periodStart(b.collectPeriod, cd), date: b.statementDate, cents: cents(amt), billId: b.id });
    }
  }
  // 调整
  for (const a of live(state, 'adjustments')) {
    if (!out[a.residentId] || !a.collectPeriod) continue;
    out[a.residentId].push({ ref: `adj:${a.id}`, type: a.kind === 'opening' ? 'opening' : 'adj', period: a.collectPeriod, due: periodStart(a.collectPeriod, cd), date: a.date || periodStart(a.collectPeriod, cd), cents: cents(a.amount), adjId: a.id, label: a.label || '' });
  }
  return out;
}

/**
 * 先到期先抵：借方 = 正的应收项 + 退款；贷方 = 收款 + 负的应收项（减免）。
 * @returns {{ debits: Array<item & { remaining, paidOn }>, credit: number, applied: Record<string, number> }}  （都是分）
 */
export function settle(items, payments, assignedOnly = false) {
  if (assignedOnly) return settleAssigned(items, payments);
  const debits = [], credits = [];
  for (const it of items) {
    if (it.unknown || it.cents == null) continue;
    if (it.cents > 0) debits.push({ ...it, remaining: it.cents, paidOn: null });
    else if (it.cents < 0) credits.push({ id: it.ref, date: it.due, left: -it.cents });
  }
  for (const p of payments) {
    const c = cents(p.amount);
    if (c > 0) credits.push({ id: p.id, date: p.date, left: c });
    else if (c < 0) debits.push({ ref: 'refund:' + p.id, type: 'refund', due: p.date, date: p.date, cents: -c, remaining: -c, paidOn: null });
  }
  debits.sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : (TYPE_ORDER[a.type] - TYPE_ORDER[b.type]) || (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0)));
  credits.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  let i = 0;
  for (const cr of credits) {
    while (cr.left > 0 && i < debits.length) {
      const d = debits[i];
      const take = Math.min(cr.left, d.remaining);
      d.remaining -= take; cr.left -= take;
      if (!d.remaining) { d.paidOn = cr.date; i++; }
    }
  }
  return { debits, credit: credits.reduce((a, c) => a + c.left, 0) };
}

/** 指定租期的收款与退款只影响该租期，余额不自动转给其他租期。 */
function settleAssigned(items, payments) {
  const groups = new Map();
  for (const p of payments) if (p.rentId) {
    const ref = rentRef(p.rentId);
    if (!groups.has(ref)) groups.set(ref, []);
    groups.get(ref).push(p);
  }
  const debits = []; let credit = 0;
  for (const item of items) {
    const rows = (groups.get(item.ref) || []).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
    groups.delete(item.ref);
    const paid = rows.reduce((n, p) => n + cents(p.amount), 0);
    if (item.unknown || item.cents == null) { credit += Math.max(0, paid); continue; }
    let running = 0, paidOn = null;
    for (const p of rows) {
      running += cents(p.amount);
      if (running < item.cents) paidOn = null;
      else if (!paidOn) paidOn = p.date;
    }
    debits.push({ ...item, remaining: Math.max(0, item.cents - paid), paidOn });
    credit += Math.max(0, paid - item.cents);
  }
  for (const rows of groups.values()) credit += Math.max(0, rows.reduce((n, p) => n + cents(p.amount), 0));
  return { debits, credit };
}

/**
 * 整本账：每户的余额、逾期、按期统计。金额都转回美元。
 * @returns {{ people: Record<string, Person>, period: (key) => PeriodStats, current: string, cd: number }}
 */
export function buildLedger(state, todayIso, D = {}) {
  const cd = cycleDay(state);
  const grace = state.settings.graceDays == null || state.settings.graceDays === '' ? 3 : Number(state.settings.graceDays) || 0;
  const items = receivables(state, todayIso, D);
  const pays = {};
  for (const p of live(state, 'payments')) (pays[p.residentId] = pays[p.residentId] || []).push(p);
  const people = {};
  for (const [rid, list] of Object.entries(items)) {
    const payments = (pays[rid] || []).sort((a, b) => (a.date < b.date ? -1 : 1));
    const { debits, credit } = settle(list, payments, D.assignedOnly);
    let owed = 0, overdue = 0, upcoming = 0, oldestDue = null;
    for (const d of debits) {
      owed += d.remaining;
      if (!d.remaining) continue;
      if (dayNumber(d.due) + grace < dayNumber(todayIso)) { overdue += d.remaining; if (!oldestDue || d.due < oldestDue) oldestDue = d.due; }
      else upcoming += d.remaining;
    }
    const totalCharges = list.reduce((a, x) => a + (x.cents || 0), 0);
    const totalPaid = payments.reduce((a, p) => a + cents(p.amount), 0);
    people[rid] = {
      items: list, payments, debits,
      balance: dollars(totalCharges - totalPaid),        // 正 = 欠我，负 = 预付
      outstanding: dollars(owed), credit: dollars(credit),
      overdue: dollars(overdue), overdueDays: oldestDue ? dayNumber(todayIso) - dayNumber(oldestDue) : 0,
      upcoming: dollars(upcoming),
      unknownRent: list.filter(x => x.unknown).map(x => x.period),
      lastPayment: payments.filter(p => cents(p.amount) > 0).slice(-1)[0] || null,
      billOutstanding: dollars(debits.filter(d => d.type === 'bill').reduce((a, d) => a + d.remaining, 0)),
    };
  }
  /** 某一期：每户应付 E、已付 C（分配到这一期应收项上的钱）、状态，以及合计 */
  function period(key) {
    // E / C / left 只看正的应收（借方）：C = 已经抵上的（现金或减免），left = 还欠的，E = C + left；
    // 每人的 E 是带正负号的本期费用（和明细一致）
    const s = periodStart(key, cd), out = { key, start: s, end: periodEnd(key, cd), people: {}, E: 0, C: 0, left: 0, rentE: 0, rentC: 0, billE: 0, billC: 0, received: 0 };
    for (const [rid, p] of Object.entries(people)) {
      const mine = p.items.filter(x => x.period === key);
      const deb = p.debits.filter(x => x.period === key);
      const E = mine.reduce((a, x) => a + (x.cents || 0), 0);
      const C = deb.reduce((a, x) => a + (x.cents - x.remaining), 0);
      const Epos = deb.reduce((a, x) => a + x.cents, 0), left = deb.reduce((a, x) => a + x.remaining, 0);
      const rentE = mine.filter(x => x.type === 'rent').reduce((a, x) => a + (x.cents || 0), 0);
      const billE = mine.filter(x => x.type === 'bill').reduce((a, x) => a + x.cents, 0);
      const rentC = deb.filter(x => x.type === 'rent').reduce((a, x) => a + (x.cents - x.remaining), 0);
      const billC = deb.filter(x => x.type === 'bill').reduce((a, x) => a + (x.cents - x.remaining), 0);
      // 上期结欠 = 之前各期的应收 − 这期开始前收到的钱
      const before = p.items.filter(x => x.period < key).reduce((a, x) => a + (x.cents || 0), 0) - p.payments.filter(x => x.date < s).reduce((a, x) => a + cents(x.amount), 0);
      const paidSince = p.payments.filter(x => x.date >= s && x.date <= todayIso).reduce((a, x) => a + cents(x.amount), 0);
      let status = 'none';
      if (Epos > 0) status = !left ? 'paid' : C > 0 ? 'partial' : dayNumber(s) + grace < dayNumber(todayIso) ? 'overdue' : 'due';
      else if (E < 0) status = 'credit';
      if (mine.some(x => x.unknown)) status = status === 'none' ? 'unknown' : status;
      out.people[rid] = { E: dollars(E), C: dollars(C), left: dollars(left), rentE: dollars(rentE), billE: dollars(billE), adjE: dollars(E - rentE - billE), status, items: mine,
        previous: dollars(before), paidSince: dollars(paidSince), due: dollars(before + E - paidSince), unknown: mine.some(x => x.unknown) };
      out.E += Epos; out.C += C; out.left += left; out.rentE += rentE; out.rentC += rentC; out.billE += billE; out.billC += billC;
      out.received += p.payments.filter(x => x.date >= s && x.date < out.end).reduce((a, x) => a + cents(x.amount), 0);
    }
    for (const k of ['E', 'C', 'left', 'rentE', 'rentC', 'billE', 'billC', 'received']) out[k] = dollars(out[k]);
    return out;
  }
  return { people, period, current: periodOf(todayIso, cd), cd };
}
