// Xfinity（Comcast）网费账单，每月一张。
//
// pdf.js 按行取出的文字（列之间两个空格）大致是这样：
//   Account Number  Billing Date  Services From  Page
//   0000 00 000 0000000  Jan 24, 2030  Jan 29, 2030 to Feb 28, 2030  1 of 3    ← 每页都有这个表头；停服后的最终账单没有 Services From
//   Previous balance  $40.00
//   EFT Payment - thank you  Jan 20  -$40.00
//   Balance forward  $0.00                                                       ← 或者「Past due balance」（上期没付）
//   Balance Transferred From:  Jun 30  $1.00                                     ← 搬家时从旧地址账户转来的余额（少见）
//   Partial charges  Page 3  -$4.00                                              ← 改套餐 / 停服按天折算的退补（少见）
//   Regular monthly charges  Page 3  $40.00
//   One-time charges  Page 3  $0.00
//   Taxes, fees and other charges  $0.00
//   New charges  $36.00                                                          ← 本期新费用；也可能是「New charges due Sep 15, 2030」
//   Amount due  $36.00
//   …
//   Automatic payment  Feb 19, 2030                                              ← 自动扣款日，当作到期日
//
// 第 3 页是明细，每一大项后面跟着小项：
//   Regular monthly charges  $40.00  What's included?
//   旧版：Your Xfinity package  $40.00 / Internet: Superfast  $40.00（折扣只写「Includes …」，已经扣在里面）
//   新版：My Xfinity plan  $40.00 / My Xfinity services  $70.00 / Internet: Connect More  $70.00
//         Discounts  -$30.00 / Contract Discount  -$20.00 / Automatic Payments Discount  -$10.00
//         Equipment & services  $0.00
//   Partial charges  -$4.00 / Services removed  Feb 29 - Mar 28  -$90.00 / Services added  Feb 26 - Mar 28  $86.00
//
// 「Services From … to …」是这张账单预收的下一个服务周期（账单日之后才开始），手工账表也是照这个记的，
// 所以 periodStart / periodEnd 直接取它（账单上的结束日是包含在内的最后一天，下一期从第二天开始）。
// 停服后的最终账单没有服务周期，只有退款明细「Services removed  Aug 22 - Sep 28」，就用这段日期。
//
// 扫描件 / 照片走 OCR 时（macOS Vision 实测）：这种字体的 a 常被认成 o、1、›（Regulor、ch1rges、Billing D›te、M›1y），
// 「Sep 19,2030」逗号后没空格，表头几格的上下顺序会乱（账单日跑到服务周期后面），金额会掉到下一行，
// 明细前面多出图标认成的「•」「-」「O」。所以关键标签用 fuzzy() 认，账单日 / 周期按每页表头投票。
import { moneyIn, parseDate, round2, last4 } from './util.js';

export const id = 'xfinity';
export const name = 'Xfinity (Comcast)';
export const category = 'internet';

// ---------- 本地小工具 ----------

const A_LIKE = '(?:a|o|1|›1?|ã|á)';
/** 'Regular monthly charges' → 能容忍 OCR 把 a 认错、空格多少不一的正则片段（不带 ^$） */
function fuzzy(words) {
  return words.split(/(\s+)/).map(w => {
    if (!w) return '';
    if (/^\s+$/.test(w)) return '\\s+';
    if (/^xfinity$/i.test(w)) return 'X\\S{3,7}';                                // Xtinity、xfınıty
    return w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/a/gi, A_LIKE);
  }).join('');
}
const fuzzyRe = (alts, { start = true, end = true, flags = 'i' } = {}) =>
  new RegExp(`${start ? '^' : ''}(?:${alts.map(fuzzy).join('|')})${end ? '$' : ''}`, flags);

const RE = {
  billingDate: new RegExp(fuzzy('Billing Date'), 'i'),
  newCharges: fuzzyRe(['New charges'], { end: false }),
  regular: fuzzyRe(['Regular monthly charges']),
  partial: fuzzyRe(['Partial charges']),
  oneTime: fuzzyRe(['One-time charges', 'One time charges']),
  taxes: fuzzyRe(['Taxes'], { end: false }),
  transfer: fuzzyRe(['Balance Transferred', 'Balance transfer from'], { end: false }),
  balance: new RegExp(`\\b${fuzzy('balance')}\\b`, 'i'),                            // Previous / Past due / Remaining / New balance、Balance forward
  payment: new RegExp(`${fuzzy('payment')}|${fuzzy('thank you')}`, 'i'),
  amountDue: fuzzyRe(['Amount due', 'Total amount due', 'Amount enclosed', 'Please pay'], { end: false }),
};

// 月份名（OCR 可能是 M›1y、J›1n、Mor）+ 日 + 逗号 + 年（逗号后可能没空格）
const MON = '[A-Za-z›1]{3,9}';
const LD = `${MON}\\.?\\s+\\d{1,2},\\s*\\d{4}`;
const LD_G = new RegExp(`(${MON})\\.?\\s+(\\d{1,2}),\\s*(\\d{4})`, 'g');
const RANGE_G = new RegExp(`(${LD})\\s+to\\s+(${LD})`, 'gi');
const MONTH_NAME = /^(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|june?|july?|aug(ust)?|sep(t(ember)?)?|oct(ober)?|nov(ember)?|dec(ember)?)$/i;
const SHORT_DATE = /^[A-Z][a-z]{2}\s+\d{1,2}$/;                   // Jan 24（明细里不带年份）
const SHORT_RANGE = /^([A-Z][a-z]{2}\s+\d{1,2})\s*-\s*([A-Z][a-z]{2}\s+\d{1,2})$/;   // Feb 29 - Mar 28
const MONEY_CELL = /^-?\(?\$\s?[\d,]*\d\.\d{2}\)?$/;
const LEADING_MONEY = /^(-?\(?\$\s?[\d,]*\d\.\d{2}\)?)(?=\s|$)/;
const fmt = v => (v < 0 ? '-$' : '$') + Math.abs(v).toFixed(2);
const near = (a, b) => Math.abs(a - b) <= 0.01;
const sum = arr => round2(arr.reduce((s, x) => s + x.amount, 0));
const dayDiff = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
const slug = s => String(s).toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'other';
const clean = s => String(s).replace(/\s+/g, ' ').trim();

/** 'Jan 24, 2030' / 'Jan 24,2030' / OCR 的 'J›1n 24, 2030' → 'YYYY-MM-DD'；月份名必须是真的月份 */
function longDate(mon, day, year) {
  for (const m of [mon, mon.replace(/›1|›|1|o/g, 'a')]) {
    if (MONTH_NAME.test(m)) { const d = parseDate(`${m} ${day}, ${year}`); if (d) return d; }
  }
  return null;
}
/** 一段文字里所有能认出的长日期，按出现顺序 */
function longDates(s) {
  return [...String(s || '').matchAll(LD_G)].map(m => longDate(m[1], m[2], m[3])).filter(Boolean);
}
/** 前缀正则后面紧跟的第一个长日期 */
function dateAfterRe(all, prefix) {
  const re = new RegExp(`${prefix}(${LD})`, 'gi');
  for (const m of all.matchAll(re)) { const d = longDates(m[1])[0]; if (d) return d; }
  return null;
}

/** 'Aug 22' 这种没有年份的日期：取离账单日最近的那一年 */
function withYear(md, ref) {
  if (!ref) return null;
  const y = Number(ref.slice(0, 4));
  let best = null;
  for (const yy of [y - 1, y, y + 1]) {
    const d = parseDate(`${md}, ${yy}`);
    if (!d) continue;
    const diff = Math.abs(dayDiff(ref, d));
    if (!best || diff < best.diff) best = { d, diff };
  }
  return best ? best.d : null;
}

/** 出现次数最多的值（一样多取先出现的）；没有返回 null */
function vote(values) {
  const n = new Map();
  for (const v of values) n.set(v, (n.get(v) || 0) + 1);
  let best = null;
  for (const [v, c] of n) if (!best || c > best.c) best = { v, c };
  return best ? best.v : null;
}

// 明细里 OCR 把图标认成的前缀：•、-、+、O
const BULLET = /^(?:[•·▪●◦○*+]|[O0](?=\s+[A-Z])|-(?=\s))\s*/;

/**
 * 一行「名称  [Page 3]  [日期 / 日期范围]  金额  [右栏的其它文字]」→ { label, amount, page, dates, split }；不是这种行返回 null。
 * 有名称、Page / 日期但金额掉到了别的行（OCR）时，amount 为 null。
 * pdf.js 的行按两个空格分列（split: true）；OCR / 其它工具取出的行只有单个空格，就用宽松一点的正则。
 */
function row(line, { bullets = false } = {}) {
  let s = String(line).trim();
  if (bullets) s = s.replace(BULLET, '');
  const cells = s.split(/\s{2,}/);
  if (cells.length >= 2) {
    const label = cells[0];
    if (!/^[A-Za-z]/.test(label)) return null;
    let page = false, dates = null;
    for (let k = 1; k < Math.min(cells.length, 4); k++) {
      const c = cells[k];
      if (/^Page\s+\d+$/i.test(c)) { page = true; continue; }
      if (SHORT_DATE.test(c)) { dates = [c]; continue; }
      const r = c.match(SHORT_RANGE);
      if (r) { dates = [r[1], r[2]]; continue; }
      if (MONEY_CELL.test(c)) return { label, amount: moneyIn(c)[0], page, dates, split: true };
      break;
    }
    return page || dates ? { label, amount: null, page, dates, split: true } : null;
  }
  const SD = '[A-Z][a-z]{2}\\s+\\d{1,2}';
  const m = s.match(new RegExp(`^([A-Z][^$•]*?)\\s+(Page\\s+\\d+\\s*)?(?:(${SD})(?:\\s*-\\s*(${SD}))?\\s*)?(-?\\$\\s?[\\d,]*\\d\\.\\d{2})?$`));
  if (!m || (!m[5] && !m[2] && !m[3])) return null;
  return { label: m[1].trim(), amount: m[5] ? moneyIn(m[5])[0] : null, page: !!m[2], dates: m[3] ? (m[4] ? [m[3], m[4]] : [m[3]]) : null, split: false };
}
const leadingMoney = line => { const m = String(line || '').trim().match(LEADING_MONEY); return m ? moneyIn(m[1])[0] : null; };
const bareMoney = line => { const s = String(line || '').trim(); return MONEY_CELL.test(s) ? moneyIn(s)[0] : null; };

// 第 3 页明细里的大项标题（遇到下一个大项就停）
const TOP_RE = fuzzyRe(['Balance transfer', 'Partial charges', 'Regular monthly charges', 'One-time charges', 'One time charges',
  'Taxes, fees and other charges', 'Taxes, fees & other charges', 'Taxes and fees', 'Taxes & fees', 'Other charges & credits', 'Other charges and credits']);
const STOP_RE = /^(Additional information|Upcoming price changes|Price changes effective|Important Information|You have \d+ days from the date of this bill)/i;
const PAGE_HEADER_RE = /^(Account\s+Number\s+Billing|\.\.\.continued|continues\.\.\.)/i;

/** 在首页摘要之后找大项标题（金额也要对上），返回它后面直到下一个大项为止的所有「名称 金额」行 */
function detailRows(lines, from, labelRe, amount) {
  let start = -1;
  for (let i = Math.max(0, from); i < lines.length; i++) {
    const r = row(lines[i]);
    if (r && r.amount != null && !r.page && labelRe.test(clean(r.label)) && near(r.amount, amount)) { start = i; break; }
  }
  if (start < 0) return null;
  const rows = [];
  let texts = [];   // 上面几行没有金额的文字：OCR 时名称和金额可能被拆成两三行
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (STOP_RE.test(line)) break;
    if (PAGE_HEADER_RE.test(line)) continue;
    let r = row(line, { bullets: true });
    if (r && r.amount == null) {
      // OCR：「Services removed  Feb 29 - Mar 28」的金额在下一行开头「-$99.00  Please note…」
      const next = leadingMoney(lines[i + 1]);
      if (next != null) { r = { ...r, amount: next }; i++; } else r = null;
    }
    if (!r && MONEY_CELL.test(line) && texts.length) {
      r = { label: texts.slice(-2).join(' '), amount: moneyIn(line)[0], page: false, dates: null };
    }
    if (!r) { if (/^[A-Z]/.test(line) && !/\$/.test(line)) texts.push(line); else texts = []; continue; }
    texts = [];
    if (TOP_RE.test(clean(r.label))) break;
    rows.push(r);
  }
  return rows;
}

/**
 * 把一个大项的明细行分组：遇到「小标题」开一组，后面的行是这组的小项。
 * 小项加起来等于小标题金额就用小项，否则用小标题本身；包装层（Xfinity package / plan）没有直接小项时跳过。
 * 最后整体加起来要等于大项金额，否则返回 null（调用方退回成一项）。
 */
function expand(rows, amount, { groupRe, wrapperRe, classify, headerItem }) {
  if (!rows || !rows.length) return null;
  const groups = [];
  let cur = null;
  for (const r of rows) {
    if (groupRe.test(clean(r.label))) { cur = { head: r, kids: [] }; groups.push(cur); }
    else if (cur) cur.kids.push(r);
    else { cur = { head: null, kids: [r] }; groups.push(cur); }
  }
  const out = [];
  for (const g of groups) {
    if (!g.head) { out.push(...g.kids.map(classify)); continue; }
    if (g.kids.length && near(sum(g.kids), g.head.amount)) out.push(...g.kids.map(classify));
    else if (!g.kids.length && wrapperRe && wrapperRe.test(clean(g.head.label))) continue;
    else out.push(headerItem(g.head));
  }
  if (!near(sum(out), amount)) return null;
  return out.filter(it => !near(it.amount, 0));
}

// 常见折扣的 key 固定下来（OCR 把 Automatic 认成 Automtic / Automotic 时 key 也不变）
function discountKey(l) {
  if (/contract/i.test(l)) return 'contract_discount';
  if (/promo/i.test(l)) return 'promotional_discount';
  if (new RegExp(fuzzy('payment'), 'i').test(l)) return 'automatic_payments_discount';
  return slug(l.match(/^.*?discount/i)?.[0] || l);
}
function regularLeaf(r) {
  const l = clean(r.label);
  if (/discount|credit|promo/i.test(l)) return { key: discountKey(l), label: l, amount: r.amount };
  if (/equipment|gateway|modem|router|rental|\bxfi\b|\bpods?\b|\bbox\b/i.test(l)) return { key: 'equipment', label: l, amount: r.amount };
  if (/\binternet\b/i.test(l)) return { key: 'internet', label: l, amount: r.amount };
  return { key: slug(l), label: l, amount: r.amount };
}
function regularHeader(r) {
  const l = clean(r.label);
  if (/^discounts?$/i.test(l)) return { key: 'discounts', label: l, amount: r.amount };
  if (/equipment/i.test(l)) return { key: 'equipment', label: l, amount: r.amount };
  return { key: 'internet', label: l, amount: r.amount };
}
function feeLeaf(r) {
  const l = clean(r.label);
  return { key: slug(l), label: r.dates ? `${l} (${r.dates.join(' - ')})` : l, amount: r.amount };
}

const REGULAR = {
  groupRe: fuzzyRe(['Your Xfinity package', 'Xfinity package', 'My Xfinity plan', 'My Xfinity services', 'Discount', 'Discounts',
    'Equipment', 'Equipment & services', 'Equipment and services', 'Additional services', 'Other services']),
  wrapperRe: fuzzyRe(['Your Xfinity package', 'Xfinity package', 'My Xfinity plan']),
  classify: regularLeaf,
  headerItem: regularHeader,
};
const FEES = {   // 一次性费用、税费、其它收费 / 抵扣：小标题下面的小项逐个列出
  groupRe: fuzzyRe(['Other charges', 'Equipment', 'Installation', 'Installation & activation', 'Services', 'Taxes', 'Fees', 'Taxes and fees',
    'Taxes & fees', 'Government taxes', 'Government taxes and fees', 'Surcharges', 'Credits', 'Adjustments']),
  wrapperRe: null,
  classify: feeLeaf,
  headerItem: feeLeaf,
};

/** 每页表头「Account Number  Billing Date  [Services From]  Page」后面几行里的账单日、服务周期，各页投票 */
function headerDates(all) {
  const stmt = [], periods = [];
  for (const m of all.matchAll(new RegExp(RE.billingDate.source, 'gi'))) {
    // 表头那一行之后再看三行（pdf.js 是一行；OCR / 一格一行的取字结果会拆成好几行），到下一页的表头为止
    let end = m.index;
    for (let k = 0; k < 4 && end >= 0; k++) end = all.indexOf('\n', end + 1);
    let win = all.slice(m.index + m[0].length, end < 0 ? undefined : end).slice(0, 260);
    const nextHeader = win.search(/Account\s+Number/i);
    if (nextHeader >= 0) win = win.slice(0, nextHeader);
    // 先把「A to B」服务周期拿掉，剩下的第一个日期才是账单日（OCR 时账单日可能排在周期后面）
    win = win.replace(RANGE_G, (s, a, b) => {
      const p = [longDates(a)[0], longDates(b)[0]];
      if (p[0] && p[1]) periods.push(p.join('~'));
      return '  ';
    });
    const d = longDates(win)[0];
    if (d) stmt.push(d);
  }
  return { stmt, periods };
}

// ---------- detect ----------

const HEADER_RE = new RegExp(`${fuzzy('Account Number')}[\\s\\S]{0,80}?${fuzzy('Billing Date')}`, 'i');
const SUMMARY_ROW_RE = new RegExp(`(?:${fuzzy('New charges')}|${fuzzy('Regular monthly charges')}|${fuzzy('Partial charges')})[^\\n$]{0,40}-?\\$\\s?[\\d,]*\\d\\.\\d{2}`, 'i');

export function detect(text) {
  const t = String(text || '');
  if (!/\bxfinity\b/i.test(t) || !/\bcomcast\b/i.test(t)) return false;
  // 账单才有的东西：每页表头「Account Number  Billing Date」，加上首页摘要里带金额的一行（New charges / Regular monthly charges …）
  return HEADER_RE.test(t) && SUMMARY_ROW_RE.test(t);
}

// ---------- 解析 ----------

export function parse(lines, text) {
  lines = (lines || []).map(l => String(l));
  const all = text || lines.join('\n');
  const warnings = [];

  // ---- 账号：Comcast 账号是 16 位（0000 00 000 0000000），各处出现的投票 ----
  const accts = [];
  for (const m of all.matchAll(new RegExp(`${fuzzy('Account Number')}[\\s\\S]{0,120}`, 'gi'))) {
    const w = m[0];
    const a = w.match(/(?<!\d)\d{4} ?\d{2} ?\d{3} ?\d{7}(?!\d)/)?.[0]
      || (w.match(/(?<!\d)\d+(?: \d+)*/g) || []).find(s => { const n = s.replace(/\D/g, '').length; return n >= 10 && n <= 16; });
    if (a) accts.push(last4(a));
  }
  const accountLast4 = vote(accts);

  // ---- 账单日、服务周期（每页表头都有一份，取出现最多的）----
  const hd = headerDates(all);
  let statementDate = vote(hd.stmt);
  if (!statementDate) warnings.push('没找到账单日期（Billing Date）');
  else if (new Set(hd.stmt).size > 1) warnings.push(`各页表头的账单日期不一致（${[...new Set(hd.stmt)].join(' / ')}），取出现最多的 ${statementDate}，请核对`);

  let periodStart = null, periodEnd = null;
  let period = vote(hd.periods);
  if (!period) {   // 没认出表头时：「Services From」后面的第一段「A to B」
    const sf = all.match(new RegExp(`${fuzzy('Services From')}[\\s\\S]{0,200}?(${LD})\\s+to\\s+(${LD})`, 'i'));
    const p = sf ? [longDates(sf[1])[0], longDates(sf[2])[0]] : [];
    if (p[0] && p[1]) period = p.join('~');
  }
  if (period) [periodStart, periodEnd] = period.split('~');
  if (new Set(hd.periods).size > 1) warnings.push(`各页表头的服务周期不一致（${[...new Set(hd.periods)].join(' / ')}），取出现最多的，请核对`);

  // ---- 首页摘要：上期余额 / 付款之后，到「New charges」为止 ----
  let newIdx = -1, newCharges = null, dueDate = null;
  for (let i = 0; i < lines.length; i++) {
    let r = row(lines[i]);
    if (!r || !RE.newCharges.test(clean(r.label))) continue;
    if (r.amount == null) { const next = leadingMoney(lines[i + 1]); if (next == null) continue; r = { ...r, amount: next }; }
    newIdx = i; newCharges = r.amount;
    dueDate = longDates(r.label)[0] || null;
    break;
  }
  const isBalanceOrPayment = r => (RE.balance.test(r.label) && !RE.transfer.test(r.label))
    || (RE.payment.test(r.label) && (r.amount <= 0 || /thank|^payments?$/i.test(clean(r.label))))
    || RE.amountDue.test(clean(r.label));
  const isCategory = r => r && r.amount != null && [RE.regular, RE.partial, RE.oneTime, RE.taxes, RE.transfer].some(re => re.test(clean(r.label)));
  const summary = [];
  if (newIdx >= 0) {
    // 往上找到最近的一行「余额 / 付款」（必须是带金额的那种行；右栏的说明文字不算）
    let start = 0;
    for (let i = newIdx - 1; i >= 0; i--) {
      const r = row(lines[i]);
      if (r && r.amount != null && isBalanceOrPayment(r)) { start = i + 1; break; }
      if (PAGE_HEADER_RE.test(lines[i].trim())) { start = i + 1; break; }
    }
    // 首页摘要那行「New charges」没认出来、用的是下面付款联上的那一行时（栏位打乱的取字结果），
    // 中间一个大项都没有：退回到从「Your bill at a glance」（或开头）找起
    if (!lines.slice(start, newIdx).some(l => isCategory(row(l)))) {
      const glance = lines.findIndex((l, i) => i < newIdx && /Your\s+bill\s+at\s+a\s+gl\S{2,4}ce/i.test(l));
      start = glance >= 0 ? glance + 1 : 0;
    }
    const used = new Set();
    for (let i = start; i < newIdx; i++) {
      if (used.has(i)) continue;
      let r = row(lines[i]);
      if (!r) continue;
      if (r.amount == null) {
        // OCR：「One-time charges  Page 3」的金额单独成了上一行或下一行
        if (i + 1 < newIdx && bareMoney(lines[i + 1]) != null) { r = { ...r, amount: bareMoney(lines[i + 1]) }; used.add(i + 1); }
        else if (i > start && !used.has(i - 1) && bareMoney(lines[i - 1]) != null) r = { ...r, amount: bareMoney(lines[i - 1]) };
        else continue;
      }
      if (isBalanceOrPayment(r)) continue;
      // OCR 时「Balance Transferred From:」和「Jun 30  $1.00」可能分成两行
      if (SHORT_DATE.test(r.label) && i > start && !/\$/.test(lines[i - 1])) r = { ...r, label: lines[i - 1].trim(), dates: [r.label] };
      summary.push(r);
    }
  } else {
    warnings.push('没找到本期新费用（New charges）');
  }

  // ---- 分项 ----
  const items = [];
  const after = newIdx >= 0 ? newIdx + 1 : 0;
  let partialRows = null;
  for (const r of summary) {
    const label = clean(r.label);
    if (RE.regular.test(label)) {
      const ex = expand(detailRows(lines, after, RE.regular, r.amount), r.amount, REGULAR);
      if (ex && ex.length) items.push(...ex);
      else items.push({ key: 'internet', label: 'Internet (Regular monthly charges)', amount: r.amount });
    } else if (RE.partial.test(label)) {
      partialRows = detailRows(lines, after, RE.partial, r.amount);
      if (!near(r.amount, 0)) {
        items.push({ key: 'partial_charges', label: 'Partial charges', amount: r.amount });
        warnings.push(`本期有按天折算的调整 Partial charges ${fmt(r.amount)}（改套餐或停服时对之前已预收周期的退补），已算进本期费用`);
      }
    } else if (RE.oneTime.test(label)) {
      if (near(r.amount, 0)) continue;
      const ex = expand(detailRows(lines, after, RE.oneTime, r.amount), r.amount, FEES);
      items.push(...(ex && ex.length ? ex : [{ key: 'one_time', label: 'One-time charges', amount: r.amount }]));
    } else if (RE.taxes.test(label)) {
      if (near(r.amount, 0)) continue;
      const ex = expand(detailRows(lines, after, RE.taxes, r.amount), r.amount, FEES);
      items.push(...(ex && ex.length ? ex : [{ key: 'taxes_fees', label: 'Taxes, fees and other charges', amount: r.amount }]));
    } else if (RE.transfer.test(label)) {
      if (near(r.amount, 0)) continue;
      items.push({ key: 'balance_transfer', label: 'Balance transfer (previous account)', amount: r.amount });
      warnings.push(`New charges 里包含从旧账户转来的余额 ${fmt(r.amount)}（Balance transfer），不是这一期的网费；如果不该大家分摊，请删掉这一项并改合计`);
    } else {
      if (near(r.amount, 0)) continue;
      // 没见过的大项：带「Page 3」的、或者按列分开的短名称才算；右栏一整句说明文字不算
      if (!r.page && !(r.split && label.split(' ').length <= 6 && !/[.!?:]$/.test(label))) continue;
      const exact = new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
      const ex = expand(detailRows(lines, after, exact, r.amount), r.amount, FEES);
      items.push(...(ex && ex.length ? ex : [{ key: slug(label), label, amount: r.amount }]));
      warnings.push(`摘要里有没见过的收费项「${label}」${fmt(r.amount)}，已原样列出，请核对`);
    }
  }
  // key 不重复
  const seen = new Map();
  for (const it of items) {
    const n = (seen.get(it.key) || 0) + 1;
    seen.set(it.key, n);
    if (n > 1) it.key = `${it.key}_${n}`;
  }

  // ---- 服务周期：最终账单没有 Services From，用退款明细的日期 ----
  if (!periodStart || !periodEnd) {
    const ranges = (partialRows || []).filter(r => r.dates && r.dates.length === 2)
      .map(r => [withYear(r.dates[0], statementDate), withYear(r.dates[1], statementDate)])
      .filter(([s, e]) => s && e)
      .map(([s, e]) => (e < s ? [s, parseDate(`${Number(e.slice(0, 4)) + 1}${e.slice(4)}`) || e] : [s, e]));   // 跨年
    if (ranges.length) {
      periodStart = ranges.map(r => r[0]).sort()[0];
      periodEnd = ranges.map(r => r[1]).sort().slice(-1)[0];
      const final = /disconnected/i.test(all);
      warnings.push(`${final ? '这是停服后的最终账单，' : ''}账单上没有「Services From」服务周期，周期按 Partial charges 明细里的日期 ${periodStart} ~ ${periodEnd} 填写，请核对`);
    } else {
      warnings.push('没找到服务周期（Services From … to …）');
    }
  }
  if (periodStart && periodEnd) {
    const days = dayDiff(periodStart, periodEnd);
    if (days < 0 || days > 62) warnings.push(`服务周期 ${periodStart} ~ ${periodEnd} 看起来不对（${days} 天），请核对`);
    if (statementDate && Math.abs(dayDiff(statementDate, periodStart)) > 45) warnings.push(`账单日期 ${statementDate} 和服务周期 ${periodStart} ~ ${periodEnd} 相差太远，请核对`);
  }

  // ---- 到期日：「New charges due …」，否则自动扣款日（「Automatic payment  Feb 19, 2030」/「automatic payment on …」）----
  if (!dueDate) {
    dueDate = dateAfterRe(all, `${fuzzy('Automatic payment')}\\s+(?:on\\s+)?`)
      || dateAfterRe(all, 'payment\\s+will\\s+be\\s+applied\\s+(?:on\\s+)?')
      || dateAfterRe(all, '(?:Payment\\s+due|Due\\s+date|Due\\s+by|Please\\s+pay\\s+by|Pay\\s+by)\\s*:?\\s*');
  }

  // ---- 合计 ----
  const itemsSum = sum(items);
  let total = newCharges;
  if (total == null) {
    total = itemsSum;
    if (items.length) warnings.push('没读到 New charges，本期费用按分项相加');
  } else if (!near(itemsSum, total)) {
    warnings.push(`分项相加 ${fmt(itemsSum)} 和 New charges ${fmt(total)} 差 ${fmt(round2(total - itemsSum))}，可能有没认出来的收费项`);
  }
  if (total != null && total < 0) warnings.push(`本期新费用是负数 ${fmt(total)}（退款 / 抵扣）`);

  return {
    provider: id,
    statementDate,
    periodStart,
    periodEnd,
    dueDate: dueDate || null,
    total: round2(total ?? 0),
    items,
    usage: [],
    accountLast4,
    warnings,
  };
}
