// PG&E 能源账单（ENERGY STATEMENT）：PG&E 收电费输配和燃气，发电部分由 CCA（比如 Silicon Valley Clean Energy）收、一起列在 PG&E 账单上。
//
// 第一页「Your Account Summary」列出各部分本期费用，后面几页是各部分的明细（各有一行 Total）。
// 两处的数字都取出来互相核对；摘要里的金额有时会和标签错开一行（PDF 文字层和 OCR 都会这样），所以优先用明细页的 Total。
// 分项合计必须等于「应付总额 − 上期未付」（应付总额摘要和付款单上各有一个）；首选来源凑不上时，换用另一个来源里改动最少、
// 能凑上的读法，并加 warning；怎么都凑不上也加 warning。
// 气候补贴之类的「Electric Adjustments / Gas Adjustments」并进对应的分项（和用户表格的做法一致），并在分项名字里注明。
// 2025 年 10 月以前的 PDF 文字层是乱码，要先 OCR；这里对 OCR 常见的错（$ 认成 S、0 认成 O、l 认成 1、长破折号、
// 千分位/小数点认错、丢负号等）做了容错。
//
// 账单的结构（按行取出的文字，列之间两个空格；下面的金额、日期、账号、姓名、地址都是编的）。第 1 页：
//   Account No: 0000000000-0                         ← 每页页眉都有，账号取「-」前面的后四位
//   Statement Date:  03/09/2031                      ← 账单日期（每页页眉）
//   Due Date:  03/30/2031
//   Service For:  Your Account Summary
//   Amount Due on Previous Statement  $120.00
//   -100.00                                          ← 金额常常跑到标签的上一行（或下一行）
//   PAT DOE  Payment(s) Received Since Last Statement
//   123 EXAMPLE ST  $20.00
//   Previous Unpaid Balance
//   Current PG&E Electric Delivery Charges  $150.10
//   Electric Adjustments  -30.00                     ← 气候补贴等，偶尔才有；燃气的叫 Gas Adjustments
//   Silicon Valley Clean Energy Electric Generation Charges  40.20
//   Current Gas Charges  12.34
//   Total Amount Due by 03/30/2031  $192.64          ← 含上期未付；本期新费用 = 这个 − Previous Unpaid Balance
// 明细页：
//   Details of PG&E Electric Delivery Charges
//   01/31/2031 to 03/02/2031 (31 billing days)       ← 服务周期（旧版写成「01/31/2031 - 03/02/2031」）
//   Total PG&E Electric Delivery Charges  $150.10
//   Total Adjustments  -$30.00                       ← 跟在哪一部分的 Total 后面就属于哪一部分
//   Electric Usage This Period: 350.000000 kWh, 31 billing days
//   Details of Silicon Valley Clean Energy Electric
//   Total Silicon Valley Clean Energy
//   Electric Generation Charges  $40.20
//   Details of Gas Charges
//   Total Gas Charges  $12.34
//   Gas Usage This Period: 10.000000 Therms, 31 billing days
import { parseMoney, moneyIn, parseDate, round2, findLine, last4 } from './util.js';

export const id = 'pge';
export const name = 'PG&E';
export const category = 'energy';

const DATE = String.raw`\d{1,2}/\d{1,2}/\d{4}`;

export function detect(text) {
  const t = String(text || '');
  if (!/ENERGY\s+STATEMENT/i.test(t)) return false;
  if (!(/\bPG&E\b/.test(t) || /pge\.com/i.test(t) || /Pacific Gas and Electric/i.test(t))) return false;
  return /Electric Delivery Charges|Current Gas Charges|Details of Gas Charges/i.test(t);
}

/** OCR 容错：统一破折号；数字里的 O/o→0、I/l→1；金额前的 S→$；"52,70" → "52.70" */
function clean(line) {
  let s = String(line).replace(/[\u00a0\u2007\u202f]/g, ' ').replace(/[\u2012-\u2015\u2212]/g, '-');
  // 千分位被认错：「1.234.56」「1,234,56」→「1,234.56」（前面可能是 $ 或者被认成 S 的 $）
  // （不用 lookbehind：旧版 Safari 不支持，整个模块会加载失败）
  s = s.replace(/(^|[\s(])(-?)([$S]?)(-?)(\d{1,3})\.(\d{3})\.(\d{2})(?![\d.])/g, '$1$2$3$4$5,$6.$7');
  s = s.replace(/(^|[\s(])(-?)([$S]?)(-?)(\d{1,3}(?:,\d{3})+),(\d{2})(?=\s|$)/g, '$1$2$3$4$5.$6');
  s = s.replace(/(^|[\s(])(-?)S\s?(?=[\dOo][\dOo,]*\.[\dOo]{2}(?![\w]))/g, '$1$2$');
  s = s.replace(/(^|[\s($-])([\dOoIl][\dOoIl,]*\.[\dOo]{2})(?![\w.])/g, (m, pre, tok) => (/\d/.test(tok) ? pre + tok.replace(/[Oo]/g, '0').replace(/[Il]/g, '1') : m));
  s = s.replace(/(^|\s)(-?\$?\d{1,3}),(\d{2})(?=\s|$)/g, '$1$2.$3');
  // 日期里的 O→0、I/l→1（「O7/1l/2O31」）
  s = s.replace(/(^|[\s:(])([\dOIl]{1,2})\/([\dOIl]{1,2})\/([\dOIl]{4})(?![\dOIl])/g, (m, pre, a, b, c) => (/\d/.test(c) ? pre + [a, b, c].map(x => x.replace(/O/g, '0').replace(/[Il]/g, '1')).join('/') : m));
  return s;
}

/** label 后面同一行里的第一个金额 */
function amountAfter(line, re) {
  const m = line.match(re);
  if (!m) return null;
  const v = moneyIn(line.slice(m.index + m[0].length));
  return v.length ? v[0] : null;
}

const toDays = iso => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86400000;

/** 出现次数最多的值（OCR 偶尔认错一页的页眉时靠多数票） */
function vote(values) {
  const count = new Map();
  for (const v of values) if (v != null) count.set(v, (count.get(v) || 0) + 1);
  let best = null, n = 0;
  for (const [v, c] of count) if (c > n) { best = v; n = c; }
  return { value: best, distinct: count.size };
}

const SUMMARY = [
  ['prevDue', /Amount Due on Previous Statement/i],
  ['payments', /Payment\(?s?\)?\s+Received/i],
  ['unpaid', /Previous Unpaid Balance/i],
  ['delivery', /Current\s+PG\s?&\s?E\s+Electric\s+(?:Delivery\s+)?Charges/i],   // 没有 CCA 时可能只写 Electric Charges
  ['elecAdj', /Electric Adjustments/i],
  ['generation', /Electric Generation Charges/i],
  ['gas', /Current Gas Charges/i],
  ['gasAdj', /Gas Adjustments/i],
  ['totalDue', /Total Amount Due by/i],
];
const isSummaryLabel = line => SUMMARY.some(([, re]) => re.test(line)) || /Adjustments/i.test(line);

/** 第一页的账户摘要：各项金额；金额不在标签那一行时，看上一行/下一行有没有落单的金额 */
function readSummary(lines, warnings) {
  const start = findLine(lines, /Your Account Summary/i);
  const from = start >= 0 ? start : 0;
  let end = findLine(lines, /Total Amount Due by/i, from);
  if (end < 0) end = Math.min(lines.length - 1, from + 40);
  const out = {};
  const used = new Set();
  const pending = [];
  for (let i = from; i <= end; i++) {
    for (const [key, re] of SUMMARY) {
      if (out[key] !== undefined || !re.test(lines[i])) continue;
      // 应付总额那行标签后面先是日期，金额在最右边：取最后一个金额，免得 OCR 把日期认成 10.29.2026 时取错
      const v = key === 'totalDue' ? (moneyIn(lines[i].slice(lines[i].search(re))).pop() ?? null) : amountAfter(lines[i], re);
      if (v != null) { out[key] = v; used.add(i); } else { out[key] = null; pending.push([key, i]); }
    }
  }
  // 落单的金额：这一行有金额，但没有摘要里的任何标签（通常是左栏的姓名/地址行，或者单独一行）
  const lone = i => i >= from && i <= end && !used.has(i) && !isSummaryLabel(lines[i]) && moneyIn(lines[i]).length > 0;
  for (const [key, i] of pending) {
    const k = [i - 1, i + 1].find(lone);
    if (k == null) continue;
    const vals = moneyIn(lines[k]);
    out[key] = vals[vals.length - 1];
    used.add(k);
  }
  // 摘要里还有没认出来的金额行（比如以后新加的收费项目）：提醒用户核对
  if (start >= 0) {
    for (let i = from; i <= end; i++) {
      if (!used.has(i) && moneyIn(lines[i]).length) warnings.push(`账户摘要里有一行金额没认出来，没有算进分项：「${lines[i].trim()}」`);
    }
  }
  const gl = lines.slice(from, end + 1).find(l => /Electric Generation Charges/i.test(l));
  if (gl) {
    const seg = gl.split(/\s{2,}/).find(s => /Electric Generation Charges/i.test(s)) || '';
    const nm = seg.replace(/\s*Electric Generation Charges.*$/i, '').trim();
    if (nm && nm.length <= 60 && !/\d/.test(nm)) out.generationName = nm;
  }
  // 「Your Account Summary」这几个字没认出来、但摘要的标签都在时，也算找到了摘要
  out.found = start >= 0 || (out.totalDue !== undefined && ['delivery', 'generation', 'gas'].some(k => out[k] !== undefined));
  return out;
}

/** 第一页下面的付款单：「Total Amount Due:」下面一两行是「账号 到期日(或 Upon Receipt) 金额」，用来核对摘要里的应付总额 */
function readStubTotal(lines) {
  const re = new RegExp(`(?:${DATE}|Upon\\s+Receipt)\\s+(-?\\$?\\s?-?[\\d,]*\\d\\.\\d{2})(?!\\d)`, 'i');
  for (let i = 0; i < lines.length; i++) {
    if (!/Total Amount Due:/i.test(lines[i])) continue;
    for (let k = i; k <= Math.min(lines.length - 1, i + 3); k++) {
      const m = lines[k].match(re);
      if (m) return parseMoney(m[1]);
    }
  }
  return null;
}

/** 明细页：各部分的 Total、调整项、服务周期、用量 */
function readDetails(lines) {
  const d = {};
  const secDelivery = findLine(lines, /Details of\s+PG\s?&\s?E\s+Electric\s+(?:Delivery\s+)?Charges/i);
  // 「Details of」要在一栏的开头（行首或两个空格之后），免得说明文字里的「details of your electric …」被当成发电部分的标题
  const secGen = findLine(lines, /(?:^|\s{2})Details of\s+(?!PG\s?&\s?E\s+Electric\b)[^\d]{1,60}?\s+Electric\b/i);
  const secGas = findLine(lines, /Details of Gas Charges/i);
  d.sections = { delivery: secDelivery, generation: secGen, gas: secGas };

  // 名字：Details of Silicon Valley Clean Energy Electric [Generation Charges]
  if (secGen >= 0) {
    const seg = lines[secGen].split(/\s{2,}/).find(s => /Details of/i.test(s)) || '';
    const m = seg.match(/Details of\s+(.+?)\s+Electric\b/i);
    if (m) d.generationName = m[1].trim();
  }

  const totals = [];   // [行号, 类别]，用来判断 Total Adjustments 属于哪一部分
  const totalDeliveryRe = /Total\s+PG\s?&\s?E\s+Electric\s+(?:Delivery\s+)?Charges/i;
  const di = findLine(lines, totalDeliveryRe, Math.max(0, secDelivery));
  if (di >= 0) { d.delivery = amountAfter(lines[di], totalDeliveryRe); totals.push([di, 'delivery']); }

  const genRe = /(?:^|\s{2})(?:Total\s+.+?\s+)?Electric Generation Charges/i;
  for (let i = Math.max(0, secGen); i < lines.length && secGen >= 0; i++) {
    if (genRe.test(lines[i]) && !/Details of/i.test(lines[i])) {
      const v = amountAfter(lines[i], genRe);
      if (v != null) { d.generation = v; totals.push([i, 'generation']); break; }
    }
  }

  const gi = findLine(lines, /Total Gas Charges/i, Math.max(0, secGas));
  if (gi >= 0) { d.gas = amountAfter(lines[gi], /Total Gas Charges/i); totals.push([gi, 'gas']); }

  // 「Your Electric Charges Breakdown」最后的 Total Electric Charges 等于电费输配，备用
  const te = findLine(lines, /Total Electric Charges/i);
  if (te >= 0) d.deliveryBreakdown = amountAfter(lines[te], /Total Electric Charges/i);

  // 明细里的 Total Adjustments：归到它前面最近的那一部分
  const marks = [[secDelivery, 'delivery'], [secGen, 'generation'], [secGas, 'gas'], ...totals].filter(([i]) => i >= 0);
  d.adjustments = { delivery: null, generation: null, gas: null };
  for (let i = 0; i < lines.length; i++) {
    if (!/Total Adjustments/i.test(lines[i])) continue;
    let v = amountAfter(lines[i], /Total Adjustments/i);
    if (v == null && i + 1 < lines.length && /^\s*-?\(?\$?\s?-?[\d,]*\d\.\d{2}\)?\s*$/.test(lines[i + 1])) v = moneyIn(lines[i + 1])[0];
    const prev = marks.filter(([k]) => k < i).sort((a, b) => b[0] - a[0])[0];
    if (v != null && prev) d.adjustments[prev[1]] = round2((d.adjustments[prev[1]] || 0) + v);
  }

  // 服务周期：电费输配明细下面第一个「起 - 止 (N billing days)」；没有就用发电、燃气的
  const periodRe = new RegExp(`(${DATE})\\s*(?:-|to)\\s*(${DATE})\\s*\\(\\s*(\\d+)\\s*billing\\s+days?\\s*\\)`, 'i');
  const periodIn = from => {
    if (from < 0) return null;
    for (let i = from; i < Math.min(lines.length, from + 8); i++) {
      const m = lines[i].match(periodRe);
      if (m) return { start: parseDate(m[1]), end: parseDate(m[2]), days: +m[3] };
    }
    return null;
  };
  d.period = periodIn(secDelivery) || periodIn(secGen);
  d.periodGas = periodIn(secGas);
  if (!d.period) {
    const i = findLine(lines, periodRe);
    if (i >= 0) { const m = lines[i].match(periodRe); d.period = { start: parseDate(m[1]), end: parseDate(m[2]), days: +m[3], guessed: true }; }
  }

  // 用量：优先「Electric/Gas Usage This Period」（整期合计）；换过电表的账单会有好几行「Total Usage」（旧表那行是 0），
  // 所以退而求其次时取那一部分里最大的 Total Usage
  // OCR 偶尔把用量里的 0 认成 O
  const num = s => { const v = Number(String(s).replace(/,/g, '').replace(/[Oo]/g, '0')); return Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null; };
  const usage = (periodRe, totalRe, from) => {
    for (const l of lines) { const m = l.match(periodRe); if (m) return num(m[1]); }
    const vals = [];
    for (let i = Math.max(0, from); i < lines.length; i++) { const m = lines[i].match(totalRe); if (m) vals.push(num(m[1])); }
    return vals.length ? Math.max(...vals) : null;
  };
  const N = String.raw`(\d[\dOo,]*(?:\.[\dOo]+)?)`;
  d.kwh = usage(new RegExp(`Electric Usage This Period:?\\s*${N}\\s*kWh`, 'i'), new RegExp(`Total Usage\\s+${N}\\s*kWh`, 'i'), secDelivery);
  d.therms = usage(new RegExp(`Gas Usage This Period:?\\s*${N}\\s*Therms?`, 'i'), new RegExp(`Total Usage\\s+${N}\\s*Therms?`, 'i'), secGas);
  return d;
}

export function parse(lines, text) {
  const src = lines && lines.length ? lines : String(text || '').split('\n');
  const L = src.map(clean);
  const all = L.join('\n');
  const warnings = [];

  // —— 日期、账号：每页页眉都有，取多数 ——
  const dates = re => [...all.matchAll(re)].map(m => parseDate(m[1]));
  let st = vote(dates(new RegExp(`Statement Date:?\\s*(${DATE})`, 'gi')));
  if (!st.value) {
    // OCR 有时把日期和标签拆到相邻两行
    const near = [];
    L.forEach((l, i) => { if (/Statement Date/i.test(l)) for (const k of [i, i - 1, i + 1]) { const m = (L[k] || '').match(new RegExp(DATE)); if (m) { near.push(parseDate(m[0])); break; } } });
    st = vote(near);
  }
  const statementDate = st.value;
  if (!statementDate) warnings.push('没找到账单日期（Statement Date）');
  else if (st.distinct > 1) warnings.push(`各页的账单日期不一致，取了出现最多的 ${statementDate}`);

  const due = vote([...dates(new RegExp(`Due Date:?\\s*(${DATE})`, 'gi')), ...dates(new RegExp(`Total Amount Due by\\s*(${DATE})`, 'gi'))]);
  const dueDate = due.value;
  if (!dueDate) warnings.push('没找到到期日（Due Date）');
  else if (due.distinct > 1) warnings.push(`到期日不一致，取了出现最多的 ${dueDate}`);

  const acct = vote([...all.matchAll(/Account (?:No|Number)\.?:?\s*(\d{8,12})(?:\s*-\s*\d)?/gi)].map(m => last4(m[1])));
  const accountLast4 = acct.value;

  // —— 金额 ——
  const sum = readSummary(L, warnings);
  const det = readDetails(L);
  const stubDue = readStubTotal(L);
  if (!sum.found) warnings.push('没找到第一页的账户摘要（Your Account Summary），金额只来自明细页');

  // 每个数可能有好几个来源（明细页 Total、第一页摘要……），OCR 或错行时会互相矛盾。
  // 先用首选来源；如果分项合计凑不上「应付总额 − 上期未付」，再换来源，挑改动最少、能凑上的那一种。
  const slots = [
    makeSlot('part', 'delivery', [real(det.delivery, '明细页'), real(sum.delivery, '摘要'), real(det.deliveryBreakdown, '明细页的 Total Electric Charges')]),
    makeSlot('part', 'generation', [real(det.generation, '明细页'), real(sum.generation, '摘要')]),
    makeSlot('part', 'gas', [real(det.gas, '明细页'), real(sum.gas, '摘要')]),
    makeSlot('adj', 'delivery', [real(sum.elecAdj, '摘要'), real(det.adjustments.delivery, '明细页')], { signFlip: true }),
    makeSlot('adj', 'gas', [real(sum.gasAdj, '摘要'), real(det.adjustments.gas, '明细页')], { signFlip: true }),
  ];
  // 明细里归到发电部分的 Total Adjustments：版面错位时，它其实可能就是摘要里那笔 Electric Adjustments（不能算两次）
  const genAdj = det.adjustments.generation;
  if (genAdj != null) {
    const dup = det.adjustments.delivery == null && sum.elecAdj != null && Math.abs(sum.elecAdj - genAdj) <= 0.005;
    const skip = none('不算明细里归到发电的那笔调整（和摘要的 Electric Adjustments 是同一笔）');
    slots.push(makeSlot('adj', 'generation', dup ? [skip, real(genAdj, '明细页')] : [real(genAdj, '明细页'), skip]));
  }
  for (const s of slots.slice(0, 3)) {
    if (!s.cands.length && (det.sections[s.part] >= 0 || sum[s.part] !== undefined)) warnings.push(`没读到${s.name}的金额`);
  }
  if (sum.elecAdj === null && det.adjustments.delivery == null) warnings.push('摘要里有 Electric Adjustments，但没读到金额');
  if (sum.gasAdj === null && det.adjustments.gas == null) warnings.push('摘要里有 Gas Adjustments，但没读到金额');

  // 本期新费用应当 = 应付总额 − 上期没付清的。付款总是负数（OCR 丢了负号时补回来）
  const payments = sum.payments != null ? -Math.abs(sum.payments) : sum.payments;
  const fromPayments = sum.prevDue != null && payments != null ? round2(sum.prevDue + payments) : null;
  const unpaidCands = candidates([real(sum.unpaid, '摘要的 Previous Unpaid Balance'), real(fromPayments, '「上期应付 + 付款」')]);
  if (!unpaidCands.length && sum.prevDue === undefined && sum.payments === undefined && sum.unpaid === undefined) unpaidCands.push({ v: 0, src: '第一张账单', cost: 0 });
  const dueCands = candidates([real(sum.totalDue, '摘要'), real(stubDue, '付款单')]);
  const expects = [];
  dueCands.forEach((t, i) => unpaidCands.forEach((u, j) => expects.push({ value: round2(t.v - u.v), due: t, unpaid: u, cost: i + j })));

  const pick = choose(slots, expects);
  const exp = pick.expect;
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i], c = s.cands[pick.idx[i]], first = s.cands[0];
    if (pick.idx[i] > 0) warnings.push(`${s.name}：${first.desc}，${c.desc}；用了后者，这样分项合计才等于「应付总额 − 上期未付」`);
    else if ((!exp || pick.failed) && s.cands.length > 1 && !s.cands[1].synthetic) warnings.push(`${s.name}：${first.desc}，${s.cands[1].desc}；用了前者，请核对`);
  }
  if (pick.ambiguous) warnings.push('分项有不止一种读法都能凑上应付总额，请核对各分项');
  if (dueCands.length > 1) warnings.push(`应付总额：摘要写 ${dueCands[0].v}、付款单写 ${dueCands[1].v}，${exp && !pick.failed ? `用了${exp.due.src}的` : '请核对'}`);
  if (unpaidCands.length > 1) warnings.push(`上期未付余额 ${sum.unpaid} 和「上期应付 ${sum.prevDue} + 付款 ${payments}」对不上${exp && !pick.failed ? `，用了${exp.unpaid.src}` : ''}`);

  const val = part => slots.reduce((a, s, i) => (s.part === part && s.kind === 'part' && s.cands.length ? s.cands[pick.idx[i]].v : a), null);
  const adjOf = part => round2(slots.reduce((a, s, i) => (s.part === part && s.kind === 'adj' ? a + s.cands[pick.idx[i]].v : a), 0));

  const genName = det.generationName || sum.generationName || null;
  const items = [];
  const label = (base, a) => (a ? `${base} (incl. adjustments ${a < 0 ? '-' : ''}$${Math.abs(a).toFixed(2)})` : base);
  for (const [part, key, base] of [['delivery', 'electric_delivery', 'PG&E Electric Delivery'], ['generation', 'electric_generation', genName ? `${genName} Electric Generation` : 'Electric Generation'], ['gas', 'gas', 'PG&E Gas']]) {
    const v = val(part), a = adjOf(part);
    if (v != null || a) items.push({ key, label: label(base, a), amount: round2((v || 0) + a) });
  }
  const total = round2(items.reduce((s, it) => s + it.amount, 0));

  if (exp) {
    if (Math.abs(total - exp.value) > 0.01) warnings.push(`分项合计 ${total.toFixed(2)} 和「应付总额 ${exp.due.v} − 上期未付 ${exp.unpaid.v}」= ${exp.value.toFixed(2)} 对不上，请核对`);
  } else if (!dueCands.length) {
    warnings.push('没读到应付总额（Total Amount Due），没法核对分项合计');
  } else {
    warnings.push('没读到上期未付余额，没法核对分项合计');
  }
  const disc = all.match(/discount of\s+(\$?\s?[\d,]+\.\d{2})\s+for CA Climate Credit/i);
  if (disc) {
    const dv = parseMoney(disc[1]);
    const a = round2(adjOf('delivery') + adjOf('generation') + adjOf('gas'));
    if (dv != null && Math.abs(a + dv) > 0.01) warnings.push(`账单写气候补贴 ${dv}，但读到的调整项合计 ${a}`);
  }
  if (!items.length) warnings.push('一个分项都没读到');
  if (items.some(i => i.key === 'electric_delivery') && !items.some(i => i.key === 'electric_generation')) warnings.push('这张账单没有单独的发电（CCA）部分，电费全部算在了电费输配里，请核对');

  // —— 周期 ——
  const p = det.period;
  const periodStart = p ? p.start : null;
  const periodEnd = p ? p.end : null;
  if (!p) warnings.push('没找到服务周期');
  else {
    if (p.guessed) warnings.push('没找到电费明细里的服务周期，用了账单里第一个周期');
    if (periodStart && periodEnd && toDays(periodEnd) - toDays(periodStart) + 1 !== p.days) warnings.push(`服务周期 ${periodStart} ~ ${periodEnd} 和账单写的 ${p.days} 天对不上`);
    if (statementDate && periodEnd && (toDays(statementDate) < toDays(periodEnd) || toDays(statementDate) - toDays(periodEnd) > 31)) warnings.push('账单日期和服务周期离得不对劲，请核对');
  }

  const usage = [];
  if (det.kwh != null) usage.push({ key: 'electricity', amount: det.kwh, unit: 'kWh' });
  if (det.therms != null) usage.push({ key: 'gas', amount: det.therms, unit: 'therm' });

  return { provider: 'pge', statementDate, periodStart, periodEnd, dueDate, total, items, usage, accountLast4, warnings };
}

const PART_NAME = { delivery: '电费输配（PG&E Electric Delivery）', generation: '发电（Electric Generation）', gas: '燃气（Gas）' };
const ADJ_NAME = { delivery: '电费输配的调整项（Electric Adjustments）', generation: '发电的调整项', gas: '燃气的调整项（Gas Adjustments）' };

// —— 候选来源和挑选 ——
const real = (v, src) => (v == null ? null : { v, src, desc: `${src}写 ${v}` });
const none = desc => ({ v: 0, src: desc, desc, synthetic: true });

/** 按优先顺序去掉空的和重复的；不是首选的要付 cost 1 */
function candidates(list) {
  const out = [];
  for (const c of list) if (c && !out.some(o => Math.abs(o.v - c.v) <= 0.005)) out.push({ ...c, cost: out.length ? 1 : 0 });
  return out;
}

/** 一个待定的数（某部分的金额或调整项）。调整项没有任何来源时就是 0；signFlip：OCR 丢了负号时，可以试着把正负号反过来（代价更高） */
function makeSlot(kind, part, list, { signFlip = false } = {}) {
  const cands = candidates(list);
  if (kind === 'adj' && !cands.length) cands.push({ ...none('没有调整项'), cost: 0 });
  if (signFlip) {
    for (const c of [...cands]) {
      if (c.v && !c.synthetic && !cands.some(o => Math.abs(o.v + c.v) <= 0.005)) cands.push({ v: round2(-c.v), src: c.src, desc: `把${c.src}的 ${c.v} 当成 ${round2(-c.v)}（OCR 可能丢了正负号）`, synthetic: true, cost: 2 });
    }
  }
  return { kind, part, name: (kind === 'adj' ? ADJ_NAME : PART_NAME)[part], cands };
}

/** 先试全用首选；凑不上「应付总额 − 上期未付」时，找总代价最小、能凑上的组合。
 *  代价超过 MAX_COST（比如同时改两三处）的组合不要：那多半是硬凑出来的，宁可保留首选、提醒用户 */
const MAX_COST = 2;
function choose(slots, expects) {
  const idx = slots.map(() => 0);
  const totalOf = p => round2(slots.reduce((a, s, i) => a + (s.cands.length ? s.cands[p[i]].v : 0), 0));
  if (!expects.length) return { idx, expect: null };
  if (Math.abs(totalOf(idx) - expects[0].value) <= 0.01) return { idx, expect: expects[0] };
  let best = null, ties = 0;
  const p = [...idx];
  const walk = (i, cost) => {
    if (cost > MAX_COST || (best && cost > best.cost)) return;
    if (i === slots.length) {
      const t = totalOf(p);
      for (const e of expects) {
        if (Math.abs(t - e.value) > 0.01) continue;
        const c = cost + e.cost;
        if (c > MAX_COST) continue;
        if (!best || c < best.cost) { best = { idx: [...p], expect: e, cost: c }; ties = 0; }
        else if (c === best.cost && p.some((x, k) => x !== best.idx[k])) ties++;
      }
      return;
    }
    const n = Math.max(1, slots[i].cands.length);
    for (let c = 0; c < n; c++) { p[i] = c; walk(i + 1, cost + (slots[i].cands[c] ? slots[i].cands[c].cost : 0)); }
    p[i] = 0;
  };
  walk(0, 0);
  if (!best) return { idx, expect: expects[0], failed: true };
  return { idx: best.idx, expect: best.expect, ambiguous: ties > 0 };
}
