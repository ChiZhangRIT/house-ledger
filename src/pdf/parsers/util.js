// 各家账单解析器共用的小工具：金额、日期、在文字行里找东西。

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const pad = n => String(n).padStart(2, '0');

/** '$1,234.56' / '-$12.00' / '(12.00)' / '12.00CR' → 数字；认不出来返回 null */
export function parseMoney(s) {
  if (s == null) return null;
  const str = String(s).trim();
  const m = str.match(/^(\()?\s*(-)?\s*\$?\s*(-)?\s*([\d,]*\d(?:\.\d{1,2})?|\.\d{1,2})\s*(\))?\s*(CR|-)?$/i);
  if (!m) return null;
  const v = Number(m[4].replace(/,/g, ''));
  if (!Number.isFinite(v)) return null;
  const neg = !!(m[2] || m[3] || (m[1] && m[5]) || m[6]);
  return round2(neg ? -v : v);
}

/** 取一行里所有像金额的数（带小数点两位的），按出现顺序 */
export function moneyIn(line) {
  // 两位小数后面不能再跟数字或「.数字」：费率（0.52240）、用量（80.626000）、日期（10.29.2026）不算金额
  return [...String(line).matchAll(/(?<![\d.])-?\(?\$?\s?-?[\d,]*\d\.\d{2}(?!\d|\.\d)\)?(?:CR)?/gi)].map(m => parseMoney(m[0])).filter(v => v != null);
}

/** 各种日期写法 → 'YYYY-MM-DD'；两位年份按 20xx；认不出来返回 null */
export function parseDate(s) {
  if (!s) return null;
  const str = String(s).trim();
  let m = str.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = str.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) return iso(fullYear(+m[3]), +m[1], +m[2]);
  // 「Dec 24, 2023」「Sept. 3, 2025」「December 24 2023」：月份要是完整的月名或标准缩写，逐个候选试
  for (const x of str.matchAll(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})/g)) {
    const mo = monthOf(x[1]);
    if (mo) { const r = iso(+x[3], mo, +x[2]); if (r) return r; }
  }
  return null;
}
const fullYear = y => (y < 100 ? 2000 + y : y);
const FULL = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
function monthOf(word) {
  const w = word.toLowerCase();
  if (MONTHS[w]) return MONTHS[w];
  const i = FULL.indexOf(w);
  return i >= 0 ? i + 1 : null;
}
function iso(y, mo, d) {
  if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= 31 && y >= 1990 && y <= 2100)) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCMonth() !== mo - 1) return null;   // 比如 2/30
  return `${y}-${pad(mo)}-${pad(d)}`;
}

/** 日期加减天数 */
export function addDays(isoDate, n) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/** 四舍五入到分；负数和正数对称（-0.125 → -0.13） */
export const round2 = v => Math.sign(v) * Math.round((Math.abs(v) + Number.EPSILON) * 100) / 100 + 0;

/** 第一行匹配 re 的行号（从 from 开始找），找不到返回 -1 */
export function findLine(lines, re, from = 0) {
  const r = re.global || re.sticky ? new RegExp(re.source, re.flags.replace(/[gy]/g, '')) : re;   // 带 g 的正则 test 有状态，换成不带的
  for (let i = Math.max(0, from); i < lines.length; i++) if (r.test(lines[i])) return i;
  return -1;
}

/** 在匹配 label 的那一行（或接下来 lookahead 行）里，取 label 后面的第一个金额 */
export function moneyAfter(lines, label, lookahead = 2) {
  const i = findLine(lines, label);
  if (i < 0) return null;
  for (let k = i; k <= Math.min(lines.length - 1, i + lookahead); k++) {
    const rest = k === i ? lines[k].slice(lines[k].search(label) + (lines[k].match(label) || [''])[0].length) : lines[k];
    const v = moneyIn(rest);
    if (v.length) return v[0];
  }
  return null;
}

/** 在匹配 label 的那一行（或接下来 lookahead 行）里，取第一个日期 */
export function dateAfter(lines, label, lookahead = 2) {
  const i = findLine(lines, label);
  if (i < 0) return null;
  for (let k = i; k <= Math.min(lines.length - 1, i + lookahead); k++) {
    const rest = k === i ? lines[k].slice(lines[k].search(label)) : lines[k];
    const d = parseDate(rest.replace(label, ''));
    if (d) return d;
  }
  return null;
}

/** 只保留账号后四位；「0000001234-7」这种带校验位的取「-」前面的后四位 */
export const last4 = s => {
  const str = String(s || '').trim().replace(/-\d$/, '');
  const d = str.replace(/\D/g, '');
  return d.length >= 4 ? d.slice(-4) : null;
};
