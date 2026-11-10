// 房租日期：存储、展示均包含结束日；与到账日期独立。
import { isISODate, addDays } from './dates.js';

export const monthAfter = (key, n = 1) => {
  const [y, m] = key.slice(0, 7).split('-').map(Number), d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};
export function monthDay(key, day) {
  const [y, m] = key.slice(0, 7).split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${key.slice(0, 7)}-${String(Math.min(day, last)).padStart(2, '0')}`;
}
export const isHistory = r => r.history !== false;
export const rentRef = id => 'rent:' + id;
export const rentDates = r => isHistory(r) && !r.datesConfirmed
  ? { periodStart: null, periodEnd: null, dueDate: null, legacyDate: r.legacyDate || r.periodStart || null }
  : { periodStart: r.periodStart || null, periodEnd: r.periodEnd || null, dueDate: r.dueDate || null, legacyDate: r.legacyDate || null };
export const completeRentDates = r => {
  const d = rentDates(r);
  return isISODate(d.periodStart) && isISODate(d.periodEnd) && d.periodEnd >= d.periodStart && isISODate(d.dueDate);
};
export function rentOverlap(a, b) {
  const x = rentDates(a), y = rentDates(b);
  return isISODate(x.periodStart) && isISODate(x.periodEnd) && isISODate(y.periodStart) && isISODate(y.periodEnd)
    && x.periodStart <= y.periodEnd && y.periodStart <= x.periodEnd;
}
export const validSchedule = s => isISODate(s.from) && Number.isInteger(s.cycleDay) && s.cycleDay >= 1 && s.cycleDay <= 31
  && Number.isInteger(s.dueDay) && s.dueDay >= 1 && s.dueDay <= 31 && [-1, 0, 1].includes(s.dueMonthOffset);

/** 缺少新字段的旧记录沿用原界线；明确留空表示不自动跟踪。 */
export function rentTrackingStart(state, resident) {
  const start = resident.rentTrackingStart === undefined ? state.settings.ledgerStart && state.settings.ledgerStart + '-01' : resident.rentTrackingStart;
  return isISODate(start) ? start : null;
}

export function validateSchedules(state, resident, previous) {
  if (resident.rentTrackingStart != null && !isISODate(resident.rentTrackingStart)) return 'trackingDate';
  const schedules = resident.rentSchedules || [];
  if (schedules.some(s => !validSchedule(s))) return 'invalid';
  if (new Set(schedules.map(s => s.from)).size !== schedules.length) return 'duplicate';
  const frozen = Object.values(state.data.rents).filter(r => !r.deleted && r.residentId === resident.id && completeRentDates(r));
  const last = frozen.map(r => r.periodEnd).sort().at(-1);
  const past = list => JSON.stringify((list || []).filter(s => s.from <= last).sort((a, b) => a.from.localeCompare(b.from)));
  if (last && past(schedules) !== past(previous?.rentSchedules)) return 'frozen';
  return null;
}

/** 每位住户自己的约定。先生成候选，再由已保存的租期快照覆盖。 */
export function scheduledPeriods(state, resident, today, future = 2) {
  const terms = (resident.rentSchedules || []).filter(validSchedule).sort((a, b) => a.from.localeCompare(b.from));
  const stop = monthAfter(today, future), cutoff = rentTrackingStart(state, resident);
  if (!cutoff) return [];
  // 房租包含搬出当天；转换成内部半开区间时，截止点取次日。
  const moveOutExclusive = resident.moveOut ? addDays(resident.moveOut, 1) : null;
  // 删除快照也抑制自动候选，避免删除后以另一个自动 id 再次出现。
  const saved = Object.values(state.data.rents).filter(r => r.residentId === resident.id);
  const out = [];
  terms.forEach((term, i) => {
    let key = term.from.slice(0, 7);
    if (term.from < monthDay(key, term.cycleDay)) key = monthAfter(key, -1);
    for (let n = 0; key <= stop && n < 1200; n++, key = monthAfter(key)) {
      const nominalStart = monthDay(key, term.cycleDay), next = monthDay(monthAfter(key), term.cycleDay);
      const start = [nominalStart, term.from, resident.moveIn].sort().at(-1);
      const endExclusive = [next, terms[i + 1]?.from, moveOutExclusive].filter(Boolean).sort()[0];
      if (start >= endExclusive || start < cutoff) continue;
      const rec = { id: `rp:${resident.id}:${start}`, residentId: resident.id, history: false, datesConfirmed: true,
        periodStart: start, periodEnd: addDays(endExclusive, -1), dueDate: monthDay(monthAfter(key, term.dueMonthOffset), term.dueDay),
        nominalKey: key, cycleDay: term.cycleDay };
      if (state.data.rents[rec.id]?.deleted || saved.some(r => r.id === rec.id || rentOverlap(r, rec))) continue;
      out.push(rec);
    }
  });
  return out;
}

export function validateRentPeriod(state, rec) {
  const person = state.data.residents[rec.residentId];
  if (!person || person.deleted || person.isOwner) return 'tenant';
  const d = rentDates(rec);
  if ([d.periodStart, d.periodEnd, d.dueDate].some(x => x != null && !isISODate(x))) return 'date';
  if (d.periodStart && d.periodEnd && d.periodEnd < d.periodStart) return 'range';
  if (!d.periodStart && !d.dueDate && !d.legacyDate && !isISODate(rec.paidDate)) return 'required';
  // 手动记录不受自动计算起点限制；只与已保存的记录查重，自动候选会让位。
  if (Object.values(state.data.rents).some(r => !r.deleted && r.id !== rec.id && r.residentId === rec.residentId && rentOverlap(rec, r))) return 'overlap';
  return null;
}
