// City of Sunnyvale 市政账单（水、污水、垃圾，两个月一张）。
//
// 账单第一页的结构（pdf.js 按行取出的文字，列之间两个空格；下面的数字都是编的）：
//   UTILITY ACCOUNT SUMMARY FOR 000000-00000
//   Previous Balance  $  300.00
//   Adjustments and/or Penalties  0.00
//   Payment 01/02/2030, Thank You  300.00 CR      ← 上期付款，可能有多行
//   Balance Forward  0.00                          ← 有用水图表的版本里金额掉到下一行
//   Current Charges  320.00                        ← 本期新费用
//   Total Amount Due  $  320.00
//   ACCOUNT DETAIL  AMOUNT
//   WATER SERVICE  SERVICE PERIOD  DAYS  PREVIOUS READ CURRENT READ
//   Domestic Meter #00000000  12/10/29 02/08/30  60  2000.00  2008.00   ← 水表周期 = 账单周期
//   Service Chrg 1" Mtr  12/10/29 02/08/30  70.00
//   Water Consumption  8.00 CCF  x  5.00  =  40.00
//   Total Water Service  8.00 CCF  $  110.00
//   SEWER SERVICE …  Total Sewer Service  $  120.00
//   GARBAGE SERVICE …  Total Garbage Service  $  90.00
//   Total Current Charges  $  320.00
//   …（缴费联）Bill Date:  02/14/2030   Payment Due:  Upon Presentation   Past Due After:  Auto Pay on 03/06/2030
//
// 污水、垃圾的服务周期和水表周期差几天，账单周期按水表的算（和手工账表一致）。
// 7 月 1 日调价时同一分区会拆成两段，分项仍然取每个分区的「Total … Service」。
// 小于 1 的数账单上不写前导 0（「.94 CCF」）。
//
// OCR 的文字行顺序不可靠：分区合计的金额可能跑到上一行或下一行，甚至和别的行挤在一起。
// 所以每个分区的金额先收集几个候选（同一行 / 相邻只有金额的行 / 分区明细逐行相加），
// 再挑一组加起来正好等于 Current Charges 的；pdf.js 取出的正常文字直接就是同一行那个。
import { parseMoney, parseDate, round2, findLine, dateAfter, last4 } from './util.js';

export const id = 'sunnyvale';
export const name = 'City of Sunnyvale Utilities';
export const category = 'water';

export function detect(text) {
  const t = String(text || '');
  if (!/City\s+of\s+Sunnyvale/i.test(t)) return false;
  if (/UTILITY\s+ACCOUNT\s+SUMMARY/i.test(t)) return true;
  // OCR 偶尔丢掉标题：再看有没有水 / 污水两个分区和「Total Current Charges」
  return /Total\s+Water\s+Service/i.test(t) && /Total\s+Sewer\s+Service/i.test(t) && /Total\s+Current\s+Charges/i.test(t);
}

// ---- 本地小工具 ----
// 金额：两位小数；可以没有前导 0（「.85」）；贷方「123.45 CR」（中间有空格，util.moneyIn 认不出）或尾部负号「123.45-」算负数
const AMT = String.raw`-?\(?\$?\s?-?(?:[\d,]*\d)?\.\d{2}\)?(?!\d)`;
const CREDIT = String.raw`\s*CR\b|-(?=\s|$)`;
const MONEY_RE = new RegExp(`(${AMT})(${CREDIT})?`, 'gi');
const amountsIn = s => [...String(s).matchAll(MONEY_RE)].map(m => parseMoney(m[1] + (m[2] ? 'CR' : ''))).filter(v => v != null);
const lastAmount = s => { const v = amountsIn(s); return v.length ? v[v.length - 1] : null; };
const AMT_LOOSE = String.raw`\$?\s*-?\(?\$?\s*(?:[\d,]*\d)?\.\d{2}\)?(?:${CREDIT})?`;
const ONLY_AMOUNT = new RegExp(String.raw`^\s*${AMT_LOOSE}\s*$`, 'i');
// 行首就是金额、后面隔两个空格才是别的东西（用水图表的文字和摘要挤在一起时会这样）
const LEADING_AMOUNT = new RegExp(String.raw`^\s*${AMT_LOOSE}(?=\s{2,}|\s*$)`, 'i');
const ONLY_DOLLAR = /^\s*\$\s*$/;
const ONLY_CR = /^\s*CR\s*$/i;

// 用量「18.00 CCF」「.94 CCF」「12.00 CCF/55 DAYS (163.20 Gal/day)」也长得像金额，读金额之前先去掉
const NUM = String.raw`(?:\d[\d,]*(?:\.\d+)?|\.\d+)`;
const CCF_RE = new RegExp(`(${NUM})\\s*CCF\\b`, 'i');
const CCF_QTY = new RegExp(String.raw`${NUM}\s*CCF\b(?:\s*\/\s*\d+\s*DAYS)?|\(\s*${NUM}\s*Gal\/day\s*\)`, 'gi');
const stripCcf = s => String(s ?? '').replace(CCF_QTY, ' ');
const ONLY_CCF = new RegExp(`^\\s*${NUM}\\s*CCF\\s*$`, 'i');
const onlyAmount = s => { const t = stripCcf(s); return s != null && ONLY_AMOUNT.test(t) ? amountsIn(t)[0] ?? null : null; };

/** 第 i 行 label 后面的第一个金额；那一行没有时，只接受下一行行首的金额（中间可以隔一行单独的 $），免得拿到别的项目的数。
 *  「CR」被挤到下一行（别的取字工具会这样）时也算贷方。 */
function amountAt(lines, i, label) {
  if (i < 0 || i >= lines.length) return null;
  const line = lines[i], m = line.match(label);
  const rest = m ? line.slice(m.index + m[0].length) : line;
  const credit = (v, k) => (v > 0 && ONLY_CR.test(lines[k + 1] || '') ? -v : v);
  const same = amountsIn(rest);
  if (same.length) return credit(same[0], i);
  for (let k = i + 1; k < Math.min(lines.length, i + 3); k++) {
    if (ONLY_DOLLAR.test(lines[k])) continue;
    const mm = lines[k].match(LEADING_AMOUNT);
    return mm ? credit(amountsIn(mm[0])[0], k) : null;
  }
  return null;
}
const amountOf = (lines, label) => amountAt(lines, findLine(lines, label), label);

/** 和 util.dateAfter 一样，但第一处匹配的行里没有日期时接着往下找（第二页的说明文字里也有「bill date」） */
function firstDate(lines, label, lookahead) {
  for (let i = findLine(lines, label); i >= 0; i = findLine(lines, label, i + 1)) {
    const d = dateAfter(lines.slice(i), label, lookahead);
    if (d) return d;
  }
  return null;
}

// mm/dd/yy 或 mm/dd/yyyy
const DATE_RE = /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g;
const datesIn = line => (String(line).match(DATE_RE) || []).map(parseDate).filter(Boolean);
const dayDiff = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
const num = s => Number(String(s).replace(/,/g, ''));
const near = (a, b) => Math.abs(a - b) <= 0.011;
const fmt = v => v.toFixed(2);

/** 「Total Garbage Service」之类的分区名 → 分项 key */
function itemKey(label) {
  const s = label.toLowerCase();
  if (/sewer|waste\s*water|sanitary/.test(s)) return 'sewer';
  if (/storm/.test(s)) return 'storm_drain';
  if (/recycled\s+water/.test(s)) return 'recycled_water';
  if (/garbage|solid\s*waste|refuse|trash|recycl|compost|food\s*scrap/.test(s)) return 'garbage';
  if (/water/.test(s)) return 'water';
  return s.replace(/\b(service|services|charges?|fees?)\b/g, '').trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'other';
}
const titleCase = s => s.toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase());

// 明细里的分区合计行：「Total Water Service」「Total Storm Drain Fees」「Total Utility Users Tax」「Total Rate Assistance Credit」…
const SECTION_RE = /^\s*Total\s+([A-Za-z][A-Za-z &\/'-]*?\s+(?:Services?|Charges?|Fees?|Credits?|Discounts?|Rebates?|Refunds?|Adjustments?|Tax(?:es)?|Surcharges?|Penalt(?:y|ies)|Assessments?))\b(.*)$/i;

/** 分区明细逐行相加（每行取最后一个金额；水表读数行、表头不算） */
function linesSum(body) {
  let sum = null;
  for (const l of body) {
    if ((/\bMeter\b/i.test(l) && !/Chrg|Charge/i.test(l)) || /PREVIOUS\s+READ/i.test(l)) continue;
    const v = lastAmount(stripCcf(l));
    if (v != null) sum = round2((sum || 0) + v);
  }
  return sum;
}

/** 收集明细里每个分区的合计金额候选。rank 越小越可信：0 同一行、1 下一行、2 上一行、3 逐行相加 */
function collectSections(detail) {
  const sections = [];
  let bodyStart = 0, skipNext = false;
  for (let i = 0; i < detail.length; i++) {
    const m = detail[i].match(SECTION_RE);
    if (!m || /\b(current|amount)\b/i.test(m[1])) continue;
    const label = titleCase(m[1].replace(/\s+/g, ' ').trim());
    const cands = [];
    const same = lastAmount(stripCcf(m[2]));
    if (same != null) cands.push({ v: same, rank: 0, at: i });
    const next = onlyAmount(detail[i + 1]);
    if (next != null) cands.push({ v: next, rank: 1, at: i + 1 });
    const prev = i - 1 >= bodyStart ? onlyAmount(detail[i - 1]) : null;
    if (prev != null) cands.push({ v: prev, rank: 2, at: i - 1 });
    if (same == null) {
      // 合计行上没有金额（OCR 丢了或认错了）：把这个分区每行的金额加起来作为备选；相邻那几行单独的金额不算进去
      const body = detail.slice(bodyStart + (skipNext ? 1 : 0), prev != null ? i - 1 : i);
      const v = linesSum(body);
      if (v != null) cands.push({ v, rank: 3 });
    }
    // 用水量：同一行的「18.00 CCF」，其次上下行单独的「18.00 CCF」
    let ccf = m[2].match(CCF_RE);
    if (!ccf && ONLY_CCF.test(detail[i + 1] || '')) ccf = detail[i + 1].match(CCF_RE);
    if (!ccf && i - 1 >= bodyStart && ONLY_CCF.test(detail[i - 1] || '')) ccf = detail[i - 1].match(CCF_RE);
    sections.push({ label, key: itemKey(label), cands, ccf: ccf ? num(ccf[1]) : null });
    bodyStart = i + 1;
    skipNext = next != null;
  }
  return sections;
}

/** 每个分区挑一个候选，使分项加起来等于 target；最多一个分区完全没有候选时，用 target 减去其他分区推算。挑不出来返回 null */
function resolveSections(sections, target) {
  const free = sections.map((s, i) => (s.cands.length ? -1 : i)).filter(i => i >= 0);
  if (free.length > 1 || !sections.length) return null;
  const lists = sections.map(s => (s.cands.length ? s.cands : [null]));
  if (lists.reduce((n, l) => n * l.length, 1) > 5000) return null;   // 怪文字里分区太多：不穷举，按默认取
  let best = null, ambiguous = false;
  const pick = new Array(sections.length);
  const walk = k => {
    if (k === lists.length) {
      const used = pick.filter(c => c && c.at != null).map(c => c.at);
      if (new Set(used).size !== used.length) return;          // 同一行的金额不能给两个分区
      const sum = round2(pick.reduce((s, c) => s + (c ? c.v : 0), 0));
      let inferred = null;
      if (free.length) {
        const rest = round2(target - sum);
        if (!(rest > 0.005)) return;
        inferred = rest;
      } else if (!near(sum, target)) return;
      const score = pick.reduce((s, c) => s + (c ? c.rank : 10), 0);
      const values = pick.map(c => (c ? c.v : inferred)).join(',');
      if (!best || score < best.score) { best = { score, picks: pick.slice(), inferred, values }; ambiguous = false; }
      else if (score === best.score && values !== best.values) ambiguous = true;
      return;
    }
    for (const c of lists[k]) { pick[k] = c; walk(k + 1); }
  };
  walk(0);
  return best && { ...best, ambiguous };
}

export function parse(lines, text) {
  lines = (lines || []).map(l => String(l));
  text = text || lines.join('\n');
  const warnings = [];

  // ---- 账号（只留后四位）、日期 ----
  const acct = text.match(/Account\s+Number:?\s*(\d[\d -]*\d)/i)?.[1] || text.match(/ACCOUNT\s+SUMMARY\s+FOR\s+(\d[\d -]*\d)/i)?.[1];
  const accountLast4 = last4(acct);

  const statementDate = firstDate(lines, /Bill\s+Date:?/i, 1);
  if (!statementDate) warnings.push('没找到账单日期（Bill Date）');

  // 「Payment Due: Upon Presentation」通常没有日期，这时用「Past Due After」那天（开了自动扣款时是扣款日）
  const dueDate = firstDate(lines, /Payment\s+Due:?/i, 0) || firstDate(lines, /Past\s+Due\s+After:?/i, 1);

  // ---- 账户摘要（ACCOUNT DETAIL 之前）；用水图表的「0.00 CCF/0 DAYS」之类先去掉 ----
  const detailStart = findLine(lines, /ACCOUNT\s+DETAIL/i);
  const summaryStart = Math.max(0, findLine(lines, /ACCOUNT\s+SUMMARY|Previous\s+Balance/i));
  const summary = lines.slice(summaryStart, detailStart > summaryStart ? detailStart : undefined).map(stripCcf);
  const previous = amountOf(summary, /Previous\s+Balance/i);
  const ADJ = /Adjustments?(\s+and\/or\s+Penalties)?/i;
  const adjustments = amountOf(summary, ADJ);
  const PAY = /^\s*Payments?\b(?!\s+Due)/i;
  const payments = [], noDates = summary.map(l => l.replace(DATE_RE, ' '));   // 「Payment 01/02/2030, Thank You  300.00 CR」
  for (let i = findLine(noDates, PAY); i >= 0; i = findLine(noDates, PAY, i + 1)) {
    const v = amountAt(noDates, i, PAY);
    if (v != null) payments.push(v);
  }
  const balanceForward = amountOf(summary, /Balance\s+Forward/i);
  const summaryCurrent = amountOf(summary, /^\s*Current\s+Charges/i);
  const amountDue = amountOf(summary, /^\s*Total\s+Amount\s+Due/i);

  // ---- 明细：每个「Total … Service」就是一个分项 ----
  const from = Math.max(0, detailStart);
  let detailEnd = findLine(lines, /^\s*Total\s+Current\s+Charges/i, from);
  const detailTotal = detailEnd >= 0 ? lastAmount(stripCcf(lines[detailEnd])) : null;
  if (detailEnd < 0) detailEnd = findLine(lines, /^\s*TOTAL\s+AMOUNT\s+DUE/i, from);
  if (detailEnd < 0) detailEnd = lines.length;
  const detail = lines.slice(from, detailEnd);
  const sections = collectSections(detail);
  if (!sections.length) warnings.push('没找到明细里的分项（Total Water / Sewer / Garbage Service）');

  // ---- 本期费用 = Current Charges；分区金额挑一组加起来等于它的 ----
  const targets = [...new Set([detailTotal, summaryCurrent].filter(v => v != null))];
  let current = detailTotal ?? summaryCurrent, chosen = null;
  for (const t of targets) {
    const r = resolveSections(sections, t);
    if (r && (!chosen || r.score < chosen.score)) { chosen = r; current = t; }
  }
  if (detailTotal != null && summaryCurrent != null && !near(detailTotal, summaryCurrent)) {
    warnings.push(`摘要里的 Current Charges $${fmt(summaryCurrent)} 和明细合计 $${fmt(detailTotal)} 不一致，按${current === detailTotal ? '明细合计' : '摘要'}（和分项相加对得上的那个）`);
  }
  if (chosen?.ambiguous) warnings.push('分区金额有不止一种读法都能对上本期费用，请核对各分项');

  const items = [];
  let waterCcf = null;
  sections.forEach((s, k) => {
    // 对上了本期费用就用挑出来的那组；对不上时每个分区取最可信的候选
    const c = chosen ? chosen.picks[k] : (s.cands.slice().sort((a, b) => a.rank - b.rank)[0] || null);
    const amount = c ? c.v : chosen ? chosen.inferred : null;
    if (amount == null) { warnings.push(`「Total ${s.label}」这一行没有读到金额`); return; }
    if (!c) warnings.push(`「Total ${s.label}」这一行没有读到金额，按本期费用 $${fmt(current)} 减去其他分项推算为 $${fmt(amount)}，请核对`);
    else if (c.rank === 3) warnings.push(`「Total ${s.label}」这一行没有读到金额，按这个分区各行相加得 $${fmt(amount)}，请核对`);
    else if (c.rank > 0 && !chosen) warnings.push(`「Total ${s.label}」的金额 $${fmt(amount)} 取自相邻的一行，请核对`);
    if (s.key === 'water' && s.ccf != null) waterCcf = round2((waterCcf || 0) + s.ccf);
    const same = items.find(it => it.key === s.key);
    if (same) { same.amount = round2(same.amount + amount); same.label += ' + ' + s.label; }
    else items.push({ key: s.key, label: s.label, amount });
  });

  if (current == null) {
    current = round2(items.reduce((s, it) => s + it.amount, 0));
    warnings.push('没找到 Current Charges，本期费用按分项相加');
  }

  // 摘要里的「Adjustments and/or Penalties」（滞纳金、调整）不在 Current Charges 里，但也是新产生的费用：单列一项并计入合计
  let total = current;
  if (adjustments != null && !near(adjustments, 0)) {
    items.push({ key: 'adjustments_penalties', label: 'Adjustments and/or Penalties', amount: adjustments });
    total = round2(current + adjustments);
    warnings.push(`账单上有调整/滞纳金 $${fmt(adjustments)}（账单把它归在上期余额里，不在 Current Charges $${fmt(current)} 中），已单列一项并计入合计，请确认是否该由大家分摊`);
  }

  const sum = round2(items.reduce((s, it) => s + it.amount, 0));
  if (items.length && Math.abs(sum - total) > 0.01) {
    warnings.push(`分项相加 $${fmt(sum)} 和本期费用 $${fmt(total)} 差 $${fmt(round2(total - sum))}，可能有没认出来的收费项`);
  }

  // 摘要核对：Previous Balance + 调整 − 付款 = Balance Forward；Balance Forward + Current Charges = Total Amount Due
  if (balanceForward != null && !near(balanceForward, 0)) {
    warnings.push(`有上期余额 $${fmt(balanceForward)}（负数是预付/抵扣），没有计入本期费用`);
  }
  if (previous != null && balanceForward != null) {
    const paid = round2(payments.reduce((s, v) => s + Math.abs(v), 0));   // 付款都是贷方；「CR」丢了也按付款算
    const expect = round2(previous + (adjustments || 0) - paid);
    if (!near(expect, balanceForward)) {
      warnings.push(`摘要对不上：Previous Balance $${fmt(previous)} + 调整 $${fmt(adjustments || 0)} − 付款 $${fmt(paid)} ≠ Balance Forward $${fmt(balanceForward)}，调整金额可能读错了`);
    }
  }
  if (balanceForward != null && amountDue != null && summaryCurrent != null && !near(round2(balanceForward + summaryCurrent), amountDue)) {
    warnings.push(`摘要对不上：Balance Forward $${fmt(balanceForward)} + Current Charges $${fmt(summaryCurrent)} ≠ Total Amount Due $${fmt(amountDue)}`);
  }

  // ---- 服务周期和用水量：取水表那一行 ----
  // 「Domestic Meter #…  06/20/30 08/19/30  60  2000.00  2018.00」= 开始、结束、天数、上次读数、本次读数
  let periodStart = null, periodEnd = null, readDiff = null, meterDays = null;
  const meters = detail.filter(l => /\bMeter\b/i.test(l) && !/Chrg|Charge/i.test(l) && datesIn(l).length >= 2);
  for (const l of meters) {
    const [s, e] = datesIn(l);
    if (!periodStart || s < periodStart) periodStart = s;
    if (!periodEnd || e > periodEnd) periodEnd = e;
    const r = l.match(/\d{1,2}\/\d{1,2}\/\d{2,4}\s+\d{1,2}\/\d{1,2}\/\d{2,4}\s+(\d+)(?:\s+(\d[\d,]*\.?\d*)\s+(\d[\d,]*\.?\d*))?/);
    if (r && meters.length === 1) meterDays = Number(r[1]);
    if (r && r[2] != null) {
      const d = num(r[3]) - num(r[2]);
      if (d >= 0) readDiff = round2((readDiff || 0) + d);   // 水表转了一圈（读数变小）就不比了
    }
  }
  if (!periodStart) {
    // 没有水表行：用明细里所有服务周期的最早开始、最晚结束
    for (const l of detail) {
      const ds = datesIn(l);
      if (ds.length < 2) continue;
      if (!periodStart || ds[0] < periodStart) periodStart = ds[0];
      if (!periodEnd || ds[1] > periodEnd) periodEnd = ds[1];
    }
    warnings.push(periodStart ? '没找到水表读数行，服务周期按明细里最早开始、最晚结束的日期估算' : '没找到服务周期');
  } else if (meterDays != null && dayDiff(periodStart, periodEnd) !== meterDays) {
    warnings.push(`水表周期 ${periodStart} ~ ${periodEnd} 和账单上的天数 ${meterDays} 对不上，请核对日期`);
  }

  // 用水量：优先「Total Water Service  18.00 CCF」，其次水表读数差，再其次用水图表旁边的「CURRENT CONSUMPTION: 18.00 CCF/60 DAYS」
  const usage = [];
  const consumption = text.match(new RegExp(`CURRENT\\s+CONSUMPTION:?\\s*(${NUM})\\s*CCF`, 'i'))
    || text.match(new RegExp(`(${NUM})\\s*CCF\\s*\\/\\s*\\d+\\s*DAYS`, 'i'));   // 标签和数字分了行时，第一个「x CCF/n DAYS」就是本期用量
  const ccf = waterCcf ?? readDiff ?? (consumption ? num(consumption[1]) : null);
  if (ccf != null) {
    usage.push({ key: 'water', amount: ccf, unit: 'CCF' });
    if (readDiff != null && !near(readDiff, ccf)) warnings.push(`用水量 ${ccf} CCF 和水表读数差 ${readDiff} CCF 不一致`);
  } else {
    warnings.push('没找到用水量（CCF）');
  }

  return {
    provider: id,
    statementDate,
    periodStart,
    periodEnd,
    dueDate: dueDate || null,
    total: round2(total),
    items,
    usage,
    accountLast4,
    warnings,
  };
}
