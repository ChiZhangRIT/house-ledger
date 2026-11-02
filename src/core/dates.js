// 日期都用 'YYYY-MM-DD' 字符串表示（不带时区）；区间一律是半开区间 [开始, 结束)，和表格里 DATEDIF 的算法一致。

const DAY = 86400000;
const pad = n => String(n).padStart(2, '0');

/** 'YYYY-MM-DD' → 从 1970-01-01 起的天数 */
export function dayNumber(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY);
}
/** 天数 → 'YYYY-MM-DD' */
export function fromDayNumber(n) {
  const dt = new Date(n * DAY);
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}
export const daysBetween = (a, b) => dayNumber(b) - dayNumber(a);
export const addDays = (iso, n) => fromDayNumber(dayNumber(iso) + n);
/** 两个半开区间重叠的天数 */
export function overlapDays(aStart, aEnd, bStart, bEnd) {
  const s = Math.max(dayNumber(aStart), dayNumber(bStart)), e = Math.min(dayNumber(aEnd), dayNumber(bEnd));
  return Math.max(0, e - s);
}
/** 本地时区的今天 */
export function today(now = new Date()) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
export const isISODate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && fromDayNumber(dayNumber(s)) === s;
