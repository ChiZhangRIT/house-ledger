// 界面文字和格式：简体中文 / English。文字表在 strings.js。
// t('key', { amount: 12.3, due: '2026-11-04', pct: 0.12 })：变量按名字自动格式化
//   amount/sum/diff/total/balance/paid/owed/rate → 金额；pct → 百分比；'YYYY-MM-DD' 字符串 → 日期
import { STRINGS } from './strings.js';

export const LANGS = ['zh-Hans', 'en'];
let lang = 'zh-Hans';
export const getLang = () => lang;
export function setLang(l) { lang = LANGS.includes(l) ? l : 'zh-Hans'; }
const zh = () => lang !== 'en';

const MONEY_KEYS = new Set(['amount', 'sum', 'diff', 'total', 'balance', 'paid', 'owed', 'rent', 'share']);
export function t(key, vars = {}) {
  const s = (STRINGS[lang] && STRINGS[lang][key]) ?? STRINGS['zh-Hans'][key] ?? key;
  if (typeof s === 'function') return s(vars, { money, pct, date, num });
  return s.replace(/\{(\w+)\}/g, (m, k) => {
    const v = vars[k];
    if (v == null) return m;
    if (typeof v === 'number' && MONEY_KEYS.has(k)) return money(v);
    if (typeof v === 'number' && k === 'pct') return pct(v, { sign: false, abs: true });
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return date(v);
    return String(v);
  });
}

// ---------- 数字 ----------
const nf = (d) => new Intl.NumberFormat('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const MINUS = '−';
/** $1,234.56；sign: 正数也加 +；whole: 不要分 */
export function money(v, { sign = false, whole = false } = {}) {
  if (v == null || !Number.isFinite(v)) return '—';
  const s = '$' + nf(whole ? 0 : 2).format(Math.abs(v));
  if (v < 0 && Math.abs(v) >= (whole ? 0.5 : 0.005)) return MINUS + s;
  return (sign && v > 0 ? '+' : '') + s;
}
/** +12%；abs: 只要绝对值 */
export function pct(v, { sign = true, abs = false, digits = 0 } = {}) {
  if (v == null || !Number.isFinite(v)) return '—';
  const x = Math.abs(v * 100);
  const body = x < 0.5 && digits === 0 ? '0%' : x.toFixed(digits) + '%';
  if (abs || body === '0%') return body;
  return (v > 0 ? (sign ? '+' : '') : MINUS) + body;
}
export function num(v, digits = 0) {
  if (v == null || !Number.isFinite(v)) return '—';
  return (v < 0 ? MINUS : '') + nf(digits).format(Math.abs(v));
}
/** 单价：电费常常不到 1 美元，多留一位 */
export const rate = (v, unit) => (v == null ? '—' : '$' + (Math.abs(v) < 1 ? v.toFixed(3) : v.toFixed(2)) + '/' + unitLabel(unit));
export const unitLabel = u => (u === 'therm' ? (zh() ? 'therm' : 'therm') : u || '');

// ---------- 日期 ----------
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const parts = iso => iso.split('-').map(Number);
/** style: 'medium'（2026年10月8日 / Oct 8, 2026）| 'short'（10月8日 / Oct 8）| 'num'（2026/10/8） */
export function date(iso, style = 'medium') {
  if (!iso) return '—';
  const [y, m, d] = parts(iso);
  if (style === 'num') return zh() ? `${y}/${m}/${d}` : `${m}/${d}/${y}`;
  if (style === 'short') return zh() ? `${m}月${d}日` : `${MON[m - 1]} ${d}`;
  return zh() ? `${y}年${m}月${d}日` : `${MON[m - 1]} ${d}, ${y}`;
}
/** 服务周期：2026/7/31 – 8/31 · Jul 31 – Aug 31, 2026 */
export function period(a, b) {
  if (!a || !b) return '—';
  const [y1, m1, d1] = parts(a), [y2, m2, d2] = parts(b);
  if (zh()) return y1 === y2 ? `${y1}/${m1}/${d1} – ${m2}/${d2}` : `${y1}/${m1}/${d1} – ${y2}/${m2}/${d2}`;
  return y1 === y2 ? `${MON[m1 - 1]} ${d1} – ${MON[m2 - 1]} ${d2}, ${y2}` : `${MON[m1 - 1]} ${d1}, ${y1} – ${MON[m2 - 1]} ${d2}, ${y2}`;
}
/** 月份 'YYYY-MM'：long（2026年10月）| short（10月）| axis（一月显示年份，其余显示月） */
export function month(key, style = 'long') {
  const [y, m] = parts(key);
  if (style === 'axis') return m === 1 ? String(y) : (zh() ? `${m}月` : MON[m - 1]);
  if (style === 'short') return zh() ? `${m}月` : MON[m - 1];
  return zh() ? `${y}年${m}月` : `${MON[m - 1]} ${y}`;
}
/** 相对今天：还有 3 天 / 3 天前 / 今天 */
export function relDays(n) {
  if (n === 0) return t('rel.today');
  return n > 0 ? t('rel.in', { n }) : t('rel.ago', { n: -n });
}
