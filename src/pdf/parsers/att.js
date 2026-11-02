// AT&T Fiber 网费账单（每月一张，网费按月预收：账单日期之后的一个月）。
//
// 账单的结构（pdf.js 按行取出的文字，列之间两个空格；下面的金额、日期、账号都是编的）。第 1 页：
//   Issue Date:  Mar 5, 2031                           ← 账单日期（每页页眉都有）
//   Account Number:  0000000000-0
//   AutoPay is scheduled for:                          ← 下一行是扣款日期，当作到期日
//   Mar 25, 2031
//   Account summary
//   Your last bill  $55.30
//   Payment, Feb 25 - Thank you!  -$55.30
//   Adjustment  -$20.00                                ← 账户调整：算在上期余额里，不是本期新费用
//   Remaining balance  $0.00                           ← 首张账单是「Credit balance  -$10.00」（预付款）
//   Service summary
//   Internet  Page 2  $55.30                           ← 有「What's changed?」一栏时金额掉到上一行
//   Total services  $55.30                             ← 本期新费用
//   Total due  $55.30
// 第 2 页明细：
//   Service activity
//   Account charges                                    ← 账户级的一次性费用（退票费等），平时没有
//   Activity since last bill  Feb 6 - Mar 5
//   1. Returned Check Charge  Feb 24  $20.00  < One-time charge
//   Total for Account charges  $20.00
//   Internet
//   Activity since last bill  Feb 6 - Mar 5            ← 上个周期的按天退补（改套餐、优惠变动）
//   1. Internet 300 (Fiber 300) Stand-alone  Feb 10 - Mar 5  -$8.00  < Promotion removed on Feb 10 - partial month
//   AutoPay & paperless ($5 off w/dc, $10 w/bank acct)  credit      ← 说明文字（不编号），折扣已含在套餐价里
//   Monthly charges  Mar 6 - Apr 5                     ← 账单周期
//   2. Internet 300 (Fiber 300) Stand-alone  $55.00
//   Government fees & taxes
//   3. CA County District Sales Tax  $0.10
//   Total for Internet  $47.10
// 右栏的「Usage summary / Data allowance (unlimited GB)  1,234」（本月用了多少 GB）会和左栏交错成行，
// 有时还会和左栏的小标题并成一行（「Government fees & taxes  Data allowance (unlimited GB)  1,234」）。
// OCR 出来的文字：列之间常常只有一个空格，「Page:  2of2」这类页眉会粘在一起，偶尔丢掉 $ 或小数点。
import { parseMoney, moneyIn, parseDate, round2, findLine, last4 } from './util.js';

export const id = 'att';
export const name = 'AT&T Fiber';
export const category = 'internet';

export function detect(text) {
  const t = String(text || '');
  if (!/AT\s?&\s?T/i.test(t)) return false;
  if (/^\s*Order Summary\b/i.test(t)) return false;              // 开通时的订单确认（也提到 AT&T、Internet、金额），不是账单
  // 账单才有的：页眉的 Issue Date / Account Number，和「Total services」或第 2 页的「Service activity」
  if (!/Issue Date/i.test(t) || !/Account Number/i.test(t)) return false;
  if (!/Total services|Service activity/i.test(t)) return false;
  // 要有网费这一项：第 1 页的「Internet  Page 2」、第 2 页单独一行的分区名「Internet」或「Total for Internet」
  // （只有手机等其他服务的 AT&T 账单不算）
  return /^[^\S\n]*(Internet([^\S\n]*$|[^\S\n]+Page\b|[^\S\n]{2,})|Total for Internet\b)/im.test(t);
}

const fmt = v => (v < 0 ? '-$' : '$') + Math.abs(v).toFixed(2);
const near = (a, b) => Math.abs(a - b) <= 0.011;
const dayNum = iso => Math.round(Date.parse(iso + 'T00:00:00Z') / 86400000);
const MONTH_WORD = '(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\\.?';
const DATE_TEXT = `(?:${MONTH_WORD}\\s+\\d{1,2},?\\s+\\d{4}|\\d{1,2}\\/\\d{1,2}\\/\\d{2,4})`;
// 「Aug 21 - Sep 20」，可能带年份
const RANGE_RE = new RegExp(`\\b${MONTH_WORD}\\s+(\\d{1,2})(?:,\\s*(\\d{4}))?\\s*[-–]\\s*${MONTH_WORD}\\s+(\\d{1,2})(?:,\\s*(\\d{4}))?`, 'i');
const NUM_RANGE_RE = /(\d{1,2}\/\d{1,2}\/\d{2,4})\s*[-–]\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/;
// 编号的明细行里，说明性的日期（「Sep 16」「Aug 27 - Sep 12」），用来切出名称
const ITEM_DATE_RE = new RegExp(`\\s${MONTH_WORD}\\s+\\d{1,2}\\b`, 'i');
const MONEY_RE = /-?\(?\$\s?-?[\d,]*\d\.\d{2}\)?|-?\b\d[\d,]*\.\d{2}\b/;
// 一栏末尾的金额（「(2 @ $5.00)」这种括号里的单价不算）
const MONEY_AT_END_RE = /(?:-?\$\s?-?[\d,]*\d\.\d{2}|\(\$?[\d,]*\d\.\d{2}\)|-?\b\d[\d,]*\.\d{2}\b)\s*$/;
// 一个金额（$ 可以没有：OCR 有时会丢掉）
const AMT = '-?\\(?\\$?\\s?-?[\\d,]*\\d\\.\\d{2}\\)?';
const AMOUNT_ONLY_RE = new RegExp(`^${AMT}(?:CR)?\\s*(<.*)?$`, 'i');
const TOTAL_SERVICES_RE = new RegExp(`^(?:Total services|Total new charges|New charges)\\s+(?:Page\\s*\\d+\\s+)?(${AMT})`, 'i');
const BALANCE_RE = new RegExp(`^(?:Remaining balance|Credit balance|Past due|Balance forward|Previous balance)\\s+(?:Page\\s*\\d+\\s+)?(${AMT})`, 'i');
const SUMMARY_ADJ_RE = new RegExp(`^(Adjustments?|Account adjustment|Credits?)\\s+(?:Page\\s*\\d+\\s+)?(${AMT})`, 'i');
const SECTION_TOTAL_RE = new RegExp(`^Total for\\s+(.+?)\\s+(${AMT})`, 'i');

/** 统一一行的写法：连字、各种空格、减号；去掉首尾空白 */
function normLine(s) {
  return String(s)
    .normalize('NFKC')                                                // 连字（ﬁ）、全角字符
    .replace(/[\u00a0\u2007\u202f]/g, ' ')
    .replace(/\t/g, '  ')
    .replace(/(^|\s)[\u2212\u2012\u2013\u2014]\s?(?=\$|\d)/g, '$1-')   // 「−$1.23」「–$1.23」：Unicode 减号、破折号当负号
    .replace(/(^|\s)-\s+(?=\$\s?\d)/g, '$1-')                          // 「- $1.23」：负号和 $ 之间有空格
    .replace(/(\d\.\d{2})\s+CR\b/gi, '$1CR')                          // 「5.00 CR」
    .trim();
}

/** 没有年份的「月 日」→ 离 ref 最近的那一年 */
function nearestYear(mon, day, ref) {
  if (!ref) return null;
  const y = Number(ref.slice(0, 4));
  let best = null;
  for (const yy of [y - 1, y, y + 1]) {
    const d = parseDate(`${mon} ${day}, ${yy}`);
    if (d && (best == null || Math.abs(dayNum(d) - dayNum(ref)) < Math.abs(dayNum(best) - dayNum(ref)))) best = d;
  }
  return best;
}
/** 没有年份的「月 日」→ 不早于 start 的第一个 */
function onOrAfter(mon, day, start) {
  const y = Number(start.slice(0, 4));
  for (const yy of [y, y + 1]) {
    const d = parseDate(`${mon} ${day}, ${yy}`);
    if (d && d >= start) return d;
  }
  return null;
}
/** 一行里的日期区间 → { start, end }；没年份时按 ref（账单日期）推 */
function parseRange(line, ref) {
  let m = String(line).match(RANGE_RE);
  if (m) {
    const start = m[3] ? parseDate(`${m[1]} ${m[2]}, ${m[3]}`) : nearestYear(m[1], m[2], ref);
    if (!start) return null;
    const end = m[6] ? parseDate(`${m[4]} ${m[5]}, ${m[6]}`) : onOrAfter(m[4], m[5], start);
    return end ? { start, end } : null;
  }
  m = String(line).match(NUM_RANGE_RE);
  if (m) {
    const start = parseDate(m[1]), end = parseDate(m[2]);
    return start && end ? { start, end } : null;
  }
  return null;
}

/** 在全文里找「标签 + 日期」（日期可以在下一行） */
function dateAfterLabel(text, labelSrc) {
  const m = text.match(new RegExp(`${labelSrc}[ \\t:]*\\n?[ \\t]*(${DATE_TEXT})`, 'i'));
  return m ? parseDate(m[1]) : null;
}

/** 「3. CA State Sales Tax  $0.21」→ { label, amount, note } */
function parseItemLine(line, nextLine) {
  const body = line.replace(/^\s*\d{1,2}\.\s+/, '');
  const lt = body.search(/[<\u2039\u00ab]/);
  const main = (lt >= 0 ? body.slice(0, lt) : body).trim();
  const note = lt >= 0 ? body.slice(lt + 1).trim() : '';
  // 名称：第一个两空格之前，再切掉说明性的日期。名称里的金额：有分栏时只切掉这一栏末尾的
  // （「Wi-Fi Extender (2 @ $5.00)」的单价要留着）；没分栏（OCR）时切在最后一个金额之前，和 pickAmount 一致
  const cols = main.split(/\s{2,}/);
  let label = cols[0];
  let k = label.search(ITEM_DATE_RE);
  if (k > 0) label = label.slice(0, k);
  if (cols.length > 1) k = label.search(MONEY_AT_END_RE);
  else k = [...label.matchAll(new RegExp(MONEY_RE.source, 'g'))].map(m => m.index).pop() ?? -1;
  if (k > 0) label = label.slice(0, k);
  label = label.replace(/\s+-?\$\s?[\d,.]*\d$/, '').trim();          // OCR 丢了小数点的金额（「$5500」）也不要留在名称里
  const rest = main.slice(main.indexOf(label) + label.length);
  let amount = pickAmount(rest);
  // 金额掉到下一行（只有金额的一行）
  if (amount == null && nextLine != null && AMOUNT_ONLY_RE.test(nextLine)) amount = pickAmount(nextLine.split(/[<\u2039\u00ab]/)[0]);
  return { label, amount, note };
}

/** 名称后面的金额：有两空格分栏时取第一个单独成栏的金额（后面可能是右栏的字）；
 *  没分栏（OCR）时取最后一个（前面可能是「2 @ $5.00」这种单价） */
function pickAmount(rest) {
  if (/\S\s{2,}\S|^\s{2,}\S/.test(rest)) {
    for (const col of rest.split(/\s{2,}/)) {
      const v = parseMoney(col);
      if (v != null && /\d\.\d{2}/.test(col)) return v;
    }
  }
  const vals = moneyIn(rest);
  return vals.length ? vals[vals.length - 1] : null;
}

// 页眉：「Page:  2 of 3」（OCR 会粘成「2of3」）、各页都有的 Issue Date / Account Number、单独一行的 AT&T 标志
const isPageHeader = l => /\bPage:?\s*\d+\s*of\s*\d+\b/i.test(l) || /\b(Issue Date|Account Number)\b/i.test(l) || /^AT\s?&\s?T$/i.test(l) || /\bcontinued\b/i.test(l);
// 右栏「Usage summary」里的字，会插在左栏的行中间
const isRightColumn = l => /^(Usage summary|Data|Used|Data\s+Used|\[\[Data.*|Data allowance\b.*)$/i.test(l);
const isItemLine = l => /^\s*\d{1,2}\.\s+\S/.test(l);
const hasMoney = l => moneyIn(l).length > 0;
// 常见的分区名（用来发现「Total for …」行丢了的情况）
const SECTION_NAME_RE = /^(Internet|Account charges|Account-level charges|Wireless|Phone|Home phone|Voice|TV|DIRECTV|U-verse TV)$/i;

// 明细里的小标题
function subHeading(line) {
  const l = line.trim();
  if (/^Activity since last bill\b/i.test(l)) return 'activity';
  if (/^Monthly charges\b/i.test(l)) return 'monthly';
  // 多个词的标题：后面可能接着右栏的字（两个以上空格隔开，OCR 时是「Data …」「Usage …」）
  const tail = re => { const m = l.match(re); return m && /^(\s*$|\s{2,}|\s+(Data|Usage)\b)/i.test(l.slice(m[0].length)); };
  if (/^Government fees\s*(&|and)\s*taxes\b/i.test(l) || tail(/^Taxes\s*(&|and)\s*(government\s*)?fees\b/i)) return 'taxes';
  if (tail(/^Surcharges\s*(&|and)\s*(other\s*)?fees\b/i) || tail(/^(Other\s+)?Fees\s*(&|and)\s*surcharges\b/i)) return 'fees';
  if (tail(/^Discounts?\s*(&|and)\s*credits?\b/i) || tail(/^Credits?\s*(&|and)\s*adjustments?\b/i)) return 'discounts';
  if (tail(/^Equipment charges\b/i)) return 'equipment';
  if (tail(/^One-?time charges?\b/i)) return 'one_time';
  // 单个词的标题：第一栏只有这个词
  const head = l.split(/\s{2,}/)[0];
  if (/^Taxes$/i.test(head)) return 'taxes';
  if (/^(Surcharges|Fees|Other fees)$/i.test(head)) return 'fees';
  if (/^(Discounts?|Credits?|Promotions?)$/i.test(head)) return 'discounts';
  if (/^Equipment$/i.test(head)) return 'equipment';
  if (/^Adjustments?$/i.test(head)) return 'adjustments';
  return null;
}

const PLAN_RE = /\b(internet|fiber|broadband)\b/i;
const EQUIPMENT_RE = /\b(equipment|gateway|router|modem|extender|wi-?fi\s*(pod|extender))\b/i;
const DISCOUNT_RE = /\b(discount|credit|savings?|promo(tion)?|offer|reward|loyalty)\b/i;
const PERSONAL_FEE_RE = /\b(late (payment )?(fee|charge)|returned (check|payment)|insufficient funds|reconnect(ion)?)\b/i;

function itemKey(section, sub, label, amount, note) {
  if (sub === 'taxes') return 'taxes';
  if (sub === 'fees') return 'fees';
  if (sub === 'equipment' || EQUIPMENT_RE.test(label)) return 'equipment';
  if (sub === 'adjustments') return amount < 0 ? 'discount' : 'adjustment';
  // 名称里写明是折扣/优惠的负数（「Internet Loyalty Discount」也算）；按天退补的套餐行名称里没有这些词
  if (sub === 'discounts' || (amount < 0 && DISCOUNT_RE.test(label))) return 'discount';
  if (/^account\b/i.test(section)) return 'account_charges';
  if (sub === 'one_time' || /one-?time/i.test(note) || /\b(install(ation)?|activation|setup)\b/i.test(label) || PERSONAL_FEE_RE.test(label)) return 'one_time';
  if (sub === 'activity') return 'proration';
  if (PLAN_RE.test(label)) return 'internet';
  return 'other';
}
const GROUP_LABEL = {
  internet: 'Internet',
  proration: 'Partial-month adjustments',
  discount: 'Discounts & credits',
  equipment: 'Equipment',
  fees: 'Surcharges & fees',
  taxes: 'Government fees & taxes',
  one_time: 'One-time charges',
  account_charges: 'Account charges',
  adjustment: 'Adjustments',
  other: 'Other charges',
};
const KEY_ORDER = Object.keys(GROUP_LABEL);

/** 第 1 页的「Total services」（金额可能掉到下一行） */
function findSummaryTotal(lines) {
  for (let k = 0; k < lines.length; k++) {
    const m = lines[k].match(TOTAL_SERVICES_RE);
    if (m) return moneyIn(m[1])[0] ?? null;
    if (/^Total services$/i.test(lines[k]) && AMOUNT_ONLY_RE.test(lines[k + 1] || '')) return moneyIn(lines[k + 1])[0] ?? null;
  }
  return null;
}

export function parse(lines, text) {
  const raw = Array.isArray(lines) && lines.length ? lines : String(text || '').split('\n');
  lines = raw.flatMap(l => String(l).split(/\r\n|\r|\n/)).map(normLine).filter(Boolean);
  text = lines.join('\n');
  const warnings = [];

  // ---- 账号、日期 ----
  const accLine = lines.find(l => /Account Number/i.test(l));
  const accountLast4 = accLine ? last4((accLine.match(/Account Number:?\s*[*x\u2022]*(\d[\d-]{2,}\d)/i) || [])[1]) : null;
  const statementDate = dateAfterLabel(text, 'Issue Date') || dateAfterLabel(text, 'Bill(?:ing)? date') || dateAfterLabel(text, 'Statement date');
  if (!statementDate) warnings.push('没找到账单日期（Issue Date）');
  const dueDate = dateAfterLabel(text, '\\b(?:Payment due(?: date)?|Due date|Please pay by|Pay by|Due by|Amount due by)')
    || dateAfterLabel(text, 'AutoPay is scheduled for')
    || dateAfterLabel(text, 'AutoPay is scheduled to [^\\n]*? on')
    || null;
  const summaryTotal = findSummaryTotal(lines);

  // ---- 明细（Service activity）----
  const groups = new Map();          // key → { amount, labels: [] }
  const sectionTotals = [];          // { name, amount, sum }
  let period = null, activityRange = null, periodSection = null, taxLabel = null, monthlyNoDate = false;
  const extras = [];                 // 需要提醒的单项

  // 分区名：短短一行、没有金额，紧接着（跳过页眉、右栏）是小标题或编号明细
  const looksLikeSection = k => {
    const l = lines[k];
    if (!l || isItemLine(l) || hasMoney(l) || subHeading(l) || isPageHeader(l) || isRightColumn(l) || l.length > 40) return false;
    if (/^Total for\b/i.test(l) || /^(Important information|News you can use)\b/i.test(l)) return false;
    for (let j = k + 1; j < Math.min(lines.length, k + 5); j++) {
      if (isPageHeader(lines[j]) || isRightColumn(lines[j])) continue;
      return ['activity', 'monthly'].includes(subHeading(lines[j])) || isItemLine(lines[j]);
    }
    return false;
  };
  const record = it => {
    if (it.amount === 0) return;     // 比如免费安装
    const key = itemKey(it.section, it.sub, it.label, it.amount, it.note);
    if (!groups.has(key)) groups.set(key, { amount: 0, labels: [] });
    const g = groups.get(key);
    g.amount = round2(g.amount + it.amount);
    g.labels.push(it.label);
    if (key === 'account_charges' || PERSONAL_FEE_RE.test(it.label)) extras.push(it);
  };

  // start：明细从哪一行开始（「Service activity」标题的下一行）
  let start = findLine(lines, /^Service activity\b/i) + 1;
  if (start === 0) {
    // OCR 丢了这个标题：从第一个「Activity since last bill / Monthly charges」（或它上面的分区名）开始
    const k = findLine(lines, /^(Activity since last bill|Monthly charges)\b/i);
    if (k >= 0) {
      start = k > 0 && looksLikeSection(k - 1) ? k - 1 : k;
      warnings.push('没找到明细的标题（Service activity），从「' + lines[start] + '」开始读明细');
    } else {
      start = -1;
      warnings.push('没找到第 2 页的明细（Service activity）');
    }
  }
  if (start >= 0) {
    let section = null, sub = null, sum = 0, pending = [];
    const closedSum = () => round2(sectionTotals.reduce((a, s) => a + (s.amount ?? s.sum), 0));
    const closeSection = (amount, totalName) => {
      // 只有一项没读到金额（OCR 丢了小数点之类）时，用分区合计倒推
      if (pending.length === 1 && amount != null) {
        const it = pending[0];
        it.amount = round2(amount - sum);
        sum = amount;
        record(it);
        warnings.push(`明细「${it.label}」没有读到金额，按「Total for ${totalName}」倒推为 ${fmt(it.amount)}，请核对`);
      } else for (const it of pending) warnings.push(`明细「${it.label}」没有读到金额`);
      if (totalName != null) sectionTotals.push({ name: totalName, amount, sum: round2(sum) });
      else warnings.push(`明细分区「${section}」没有找到合计行（Total for ${section}）`);
      section = null; sub = null; sum = 0; pending = [];
    };
    for (let i = start; i < lines.length; i++) {
      const l = lines[i];
      if (section == null) {
        if (isPageHeader(l)) continue;
        if (looksLikeSection(i)) { section = l.split(/\s{2,}/)[0]; continue; }
        if (isItemLine(l) || subHeading(l)) section = 'Internet';                              // OCR 丢了分区名
        else if (summaryTotal != null && !near(closedSum(), summaryTotal)) continue;             // 还没对上第 1 页的合计：可能是翻页夹进来的字，接着往下找
        else break;                                                                              // 明细结束
      }
      if (/^Total for\b/i.test(l)) {
        const m = l.match(SECTION_TOTAL_RE);
        let amt = m ? moneyIn(m[2])[0] ?? null : null;
        if (amt == null && AMOUNT_ONLY_RE.test(lines[i + 1] || '')) amt = moneyIn(lines[++i])[0] ?? null;   // 金额掉到下一行
        closeSection(amt, m ? m[1].trim() : l.replace(/^Total for\s+/i, '').split(/\s{2,}/)[0].trim());
        continue;
      }
      // 上一个分区的「Total for …」行没读到，就到了下一个分区
      if (SECTION_NAME_RE.test(l) && l.toLowerCase() !== String(section).toLowerCase() && looksLikeSection(i)) {
        closeSection(null, null);
        section = l;
        continue;
      }
      const sh = subHeading(l);
      if (sh) {
        sub = sh;
        if (sh === 'taxes') taxLabel = taxLabel || l.split(/\s{2,}/)[0].replace(/\s+(Data|Usage)\b.*$/i, '');
        const r = parseRange(l, statementDate);
        if (sh === 'monthly' && r && (!period || (!PLAN_RE.test(periodSection) && PLAN_RE.test(section)))) { period = r; periodSection = section; }
        if (sh === 'monthly' && !r && PLAN_RE.test(section)) monthlyNoDate = true;
        if (sh === 'activity' && r && !activityRange) activityRange = r;
        continue;
      }
      if (!isItemLine(l)) continue;     // 说明文字、右栏的用量、页眉等
      const it = { ...parseItemLine(l, lines[i + 1]), section, sub };
      if (it.amount == null) { pending.push(it); continue; }
      sum += it.amount;
      record(it);
    }
    if (section != null) closeSection(null, null);
  }

  const items = [];
  for (const key of KEY_ORDER) {
    const g = groups.get(key);
    if (!g || g.amount === 0) continue;   // 互相抵消成 0 的（比如退补一正一负）不列
    const uniq = [...new Set(g.labels)];
    let label = uniq.length === 1 ? uniq[0] : GROUP_LABEL[key];
    if (key === 'taxes') label = taxLabel || GROUP_LABEL.taxes;
    if (key === 'proration') label = GROUP_LABEL.proration;
    items.push({ key, label, amount: g.amount });
  }
  if (!items.length) warnings.push('没找到明细里的收费项');
  for (const s of sectionTotals) {
    if (s.amount != null && !near(s.amount, s.sum)) warnings.push(`「${s.name}」明细相加 ${fmt(s.sum)} 和合计 ${fmt(s.amount)} 不一致，可能有没读到的行`);
  }

  // ---- 合计 ----
  const sum = round2(items.reduce((a, it) => a + it.amount, 0));
  const sectionSum = sectionTotals.length && sectionTotals.every(s => s.amount != null) ? round2(sectionTotals.reduce((a, s) => a + s.amount, 0)) : null;
  let total;
  if (summaryTotal != null) {
    total = summaryTotal;
    if (sectionSum != null && !near(sectionSum, summaryTotal)) warnings.push(`第 1 页的 Total services ${fmt(summaryTotal)} 和明细各分区合计 ${fmt(sectionSum)} 不一致`);
  } else if (sectionSum != null) {
    total = sectionSum;
    warnings.push('没找到 Total services，本期费用按明细各分区合计');
  } else {
    total = sum;
    warnings.push('没找到 Total services，本期费用按分项相加');
  }
  if (!near(sum, total)) warnings.push(`分项相加 ${fmt(sum)} 和本期费用 ${fmt(total)} 差 ${fmt(round2(total - sum))}，可能有没认出来的收费项`);

  for (const it of extras) {
    warnings.push(PERSONAL_FEE_RE.test(it.label)
      ? `本期有一次性费用「${it.label}」${fmt(it.amount)}（退票费、滞纳金这类一般是个人原因产生的），已单列并计入合计，请确认是否该由大家分摊`
      : `本期有账户级的费用「${it.label}」${fmt(it.amount)}，已单列并计入合计，请确认是否该由大家分摊`);
  }

  // ---- 账户调整、上期余额（都不算本期新费用，只提醒）----
  const adjustments = [];
  const aStart = findLine(lines, /^Adjustments(\s{2,}.*)?$/i);
  if (aStart >= 0 && (start < 0 || aStart < start)) {      // 只看 Account activity 里的，不看明细里的
    for (let k = aStart + 1; k < lines.length && !/^(Total for adjustments|Remaining balance|Credit balance|Service activity)\b/i.test(lines[k]); k++) {
      if (!isItemLine(lines[k])) continue;
      const it = parseItemLine(lines[k], lines[k + 1]);
      if (it.amount != null) adjustments.push(`${it.label} ${fmt(it.amount)}`);
    }
  }
  if (!adjustments.length) {
    const sStart = findLine(lines, /^Account summary\b/i), sEnd = findLine(lines, /^Service summary\b/i);
    for (let k = sStart + 1; sStart >= 0 && k < (sEnd > sStart ? sEnd : lines.length); k++) {
      const m = lines[k].match(SUMMARY_ADJ_RE);
      const v = m ? moneyIn(m[2]) : [];
      if (v.length) adjustments.push(`${m[1]} ${fmt(v[0])}`);
    }
  }
  if (adjustments.length) warnings.push(`账户里有调整（算在上期余额里，不是本期新费用，没有计入合计）：${adjustments.join('；')}`);
  const balMatch = lines.map(l => l.match(BALANCE_RE)).find(Boolean);
  const balance = balMatch ? moneyIn(balMatch[1])[0] ?? null : null;
  if (balance != null && !near(balance, 0)) warnings.push(`上期余额 ${fmt(balance)}（${balance < 0 ? '预付款或多付的钱' : '没付清的钱'}）没有计入本期费用`);

  // ---- 账单周期：Internet 的「Monthly charges」----
  let periodStart = period ? period.start : null, periodEnd = period ? period.end : null;
  if (!period) {
    // 「Monthly charges」在但日期读不出来（OCR）时按账单日期估：网费总是预收账单日期之后的一个月。
    // 「Activity since last bill」是上个周期，只有整张账单都没有 Monthly charges（比如停机后的最后一张）时才用它。
    if (statementDate && (monthlyNoDate || !activityRange)) {
      const [y, m, d] = statementDate.split('-').map(Number);
      const s = new Date(Date.UTC(y, m - 1, d + 1)), e = new Date(Date.UTC(y, m, d));
      periodStart = s.toISOString().slice(0, 10);
      periodEnd = e.getUTCDate() === d ? e.toISOString().slice(0, 10) : new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10);
      warnings.push(`没找到 Monthly charges 的日期，账单周期按账单日期估算为 ${periodStart} ~ ${periodEnd}`);
    } else if (activityRange) {
      ({ start: periodStart, end: periodEnd } = activityRange);
      warnings.push(`没找到 Monthly charges，账单周期按「Activity since last bill」的 ${periodStart} ~ ${periodEnd}`);
    } else warnings.push('没找到账单周期（Monthly charges）');
  } else {
    const days = dayNum(periodEnd) - dayNum(periodStart);
    if (days < 26 || days > 32) warnings.push(`账单周期 ${periodStart} ~ ${periodEnd} 长度不像一个月，请核对`);
    if (statementDate && (dayNum(periodStart) < dayNum(statementDate) - 3 || dayNum(periodStart) > dayNum(statementDate) + 10)) {
      warnings.push(`账单周期从 ${periodStart} 开始，和账单日期 ${statementDate} 隔得比较远，请核对`);
    }
  }
  if (!groups.has('internet')) warnings.push('明细里没找到网费套餐（Internet）这一项');

  // ---- 用量：本月用了多少 GB（不影响分摊，只是记一下）----
  const usage = [];
  for (const l of lines) {
    const m = l.match(/Data allowance\b[^$\n]*?\s+([\d,]+(?:\.\d+)?)\s*(GB|TB)?\s*$/i) || l.match(/\bData used\b[:\s]+([\d,]+(?:\.\d+)?)\s*(GB|TB)\b/i);
    if (m) {
      const v = Number(m[1].replace(/,/g, ''));
      if (Number.isFinite(v)) { usage.push({ key: 'data', amount: v, unit: (m[2] || 'GB').toUpperCase() }); break; }
    }
  }

  return {
    provider: id,
    statementDate,
    periodStart,
    periodEnd,
    dueDate,
    total: round2(total) || 0,
    items,
    usage,
    accountLast4,
    warnings,
  };
}
