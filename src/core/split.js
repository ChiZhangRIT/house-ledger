// 分摊：一张账单按「人·天」分给参与的住户。
// 人·天 = 服务周期 [periodStart, periodEnd) 里，这户住着的每一天 × 当天的权重（几个人）。
// 住着的区间是 [moveIn, moveOut)，还没搬走的 moveOut 为 null。和原来 Numbers 表格的公式一致：
//   份额 = 总额 × 这户的人·天 / 所有参与住户的人·天之和。
import { dayNumber, fromDayNumber } from './dates.js';

/** 某户在某天的权重：weights 是按 from 排序的 [{ from: 'YYYY-MM-DD', weight }]，最早一条之前按 1 算 */
export function weightOn(resident, iso) {
  const ws = resident.weights || [];
  let w = 1;
  for (const x of ws) if (x.from <= iso) w = Number(x.weight); else break;
  return Number.isFinite(w) && w >= 0 ? w : 1;
}

/** 这户在 [start, end) 里的人·天（只看住着的日子；权重变化的地方切开算） */
export function personDays(resident, start, end) {
  const s = Math.max(dayNumber(start), dayNumber(resident.moveIn));
  const e = Math.min(dayNumber(end), resident.moveOut ? dayNumber(resident.moveOut) : Infinity);
  if (!(e > s)) return 0;
  const cuts = [s, ...(resident.weights || []).map(w => dayNumber(w.from)).filter(d => d > s && d < e), e];
  let total = 0;
  for (let i = 0; i + 1 < cuts.length; i++) total += (cuts[i + 1] - cuts[i]) * weightOn(resident, fromDayNumber(cuts[i]));
  return total;
}

/**
 * 这户怎么参与这类账单（residents[].utilities[类别]）：
 * - 'share'（或 true、没写）：照常分摊
 * - 'excluded'（或 false）：不计人·天，他那份由其他人分
 * - 'owner'：照常计人·天，但他那份记在主租客名下（比如房租已含水电网）
 */
export function participation(resident, category) {
  const v = resident.utilities && resident.utilities[category];
  return v === false || v === 'excluded' ? 'excluded' : v === 'owner' ? 'owner' : 'share';
}
export const participates = (resident, category) => participation(resident, category) !== 'excluded';

/**
 * 把金额按权重分到分，零头用最大余数法分配，保证加起来正好等于总额。
 * @param {number} total
 * @param {Array<[string, number]>} weights  [[id, 权重], ...]
 * @returns {Record<string, number>}
 */
export function splitCents(total, weights) {
  const cents = Math.round(total * 100);
  const sum = weights.reduce((a, [, w]) => a + w, 0);
  const out = {};
  if (!(sum > 0)) return out;
  const raw = weights.map(([id, w]) => ({ id, exact: cents * w / sum }));
  let given = 0;
  for (const r of raw) { r.base = Math.floor(r.exact); r.rem = r.exact - r.base; given += r.base; }
  // 先按余数从大到小补零头；余数相同时按 id 排序，哪台设备、什么顺序算都一样
  const order = raw.map((r, i) => i).sort((i, j) => raw[j].rem - raw[i].rem || (raw[i].id < raw[j].id ? -1 : raw[i].id > raw[j].id ? 1 : 0));
  for (let k = 0; k < Math.min(cents - given, raw.length); k++) raw[order[k]].base += 1;
  for (const r of raw) out[r.id] = r.base / 100;
  return out;
}

/**
 * 算一张账单的分摊。bill.periodEnd 是不含的结束日（含结束日的账单由调用方先加一天）。
 * @returns {{ shares: Record<string, number>, basis: Array<{ id, personDays, absorbed? }>, periodDays: number, fallback: boolean }}
 *   fallback 为 true 表示服务周期里没有任何参与的住户，整张账单记在主租客（isOwner）名下；
 *   basis[].absorbed 是按规则算给这户、但记到主租客名下的金额（参与方式为 'owner'）
 */
export function allocate(bill, residents, category) {
  const periodDays = dayNumber(bill.periodEnd) - dayNumber(bill.periodStart);
  const owner = residents.find(r => r.isOwner && !r.deleted);
  const basis = [];
  for (const r of residents) {
    if (r.deleted || !participates(r, category)) continue;
    const pd = personDays(r, bill.periodStart, bill.periodEnd);
    if (pd > 0) basis.push({ id: r.id, personDays: pd });
  }
  if (!basis.length) return { shares: owner ? { [owner.id]: Math.round(bill.total * 100) / 100 } : {}, basis, periodDays, fallback: true };
  const shares = splitCents(bill.total, basis.map(b => [b.id, b.personDays]));
  if (owner) {
    for (const b of basis) {
      const r = residents.find(x => x.id === b.id);
      if (r.isOwner || participation(r, category) !== 'owner') continue;
      b.absorbed = shares[b.id];
      shares[owner.id] = Math.round(((shares[owner.id] || 0) + shares[b.id]) * 100) / 100;
      delete shares[b.id];
    }
  }
  return { shares, basis, periodDays, fallback: false };
}
