// 一次性迁移：把原来 Numbers 表格（先用 numbers-parser 导出的 JSON）转成 app 能导入的数据文件。
// 用法：node tools/migrate-numbers.mjs <numbers 导出的 dump.json> <输出文件> [PDF 解析结果目录] [私人设置.private.json]
// 输出文件含有住户姓名和金额，是私人数据：请放在仓库外面（.gitignore 也排除了 house-ledger-import*.json）。
// 私人设置（也放在仓库外面）：
//   { "propertyName": "房子名称",
//     "participation": { "住户姓名": "owner" | "excluded" },   // 不分摊水电网的人：我承担 / 不参与
//     "weightChangeDate": "YYYY-MM-DD",                          // 表格里权重中途变成 ×2 的那户，从哪天算
//     "networkSwitchDate": "YYYY-MM-DD" }                        // 网费从 Xfinity 换成 AT&T 的日期（没有 PDF 对得上的网费行才用）
//
// 规则：
// - 记录 id 由名字/日期决定，同一份表格导入两次不会重复；
// - 导入的记录 updatedAt 都是 1，以后在 app 里改过的内容永远比它新，再导入也不会被覆盖；
// - 历史账单的每人金额按表格锁定（allocation.mode = 'locked'），不计入收款（collectPeriod 为空）；
// - 开账期 ledgerStart = 房租表里最后一个打过勾的期的下一期：之后的房租和新账单在 app 里收。
import fs from 'node:fs';
import path from 'node:path';

const [dumpPath, outPath, extractDir, configPath] = process.argv.slice(2);
if (!dumpPath || !outPath) { console.error('usage: node tools/migrate-numbers.mjs <dump.json> <out.json> [extractDir] [config.private.json]'); process.exit(1); }
const config = configPath && fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : {};
const dump = JSON.parse(fs.readFileSync(dumpPath, 'utf8'));
const val = v => (v && typeof v === 'object' && 'v' in v ? v.v : v);
const day = v => (typeof val(v) === 'string' ? val(v).slice(0, 10) : null);
const num = v => (typeof val(v) === 'number' ? Math.round(val(v) * 100) / 100 : null);
const slug = s => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const IMPORTED = 1;

const util = dump.find(t => t.sheet === 'Utilities').data;
const rentT = (dump.find(t => t.sheet === 'Monthly Rent') || {}).data || [];
const state = { app: 'house-ledger', v: 1, data: { providers: {}, residents: {}, bills: {}, payments: {}, rents: {} }, settings: {}, settingsAt: {} };
const put = (c, rec) => { state.data[c][rec.id] = { ...rec, updatedAt: IMPORTED }; return rec; };
const warnings = [];

// ---------- 账单公司 ----------
// periodConvention：PG&E、AT&T、Xfinity 印的结束日含在周期内（下一张从第二天开始）；市政和下一张共用边界日
const PROVIDERS = {
  pge: { name: 'PG&E', category: 'energy', parser: 'pge', cycleMonths: 1, periodConvention: 'inclusive' },
  sunnyvale: { name: 'City of Sunnyvale', category: 'water', parser: 'sunnyvale', cycleMonths: 2, periodConvention: 'shared' },
  xfinity: { name: 'Xfinity', category: 'internet', parser: 'xfinity', cycleMonths: 1, periodConvention: 'inclusive' },
  att: { name: 'AT&T Fiber', category: 'internet', parser: 'att', cycleMonths: 1, periodConvention: 'inclusive' },
};
for (const [k, p] of Object.entries(PROVIDERS)) put('providers', { id: 'p_' + k, ...p, active: k !== 'xfinity' });

// ---------- 住户（表头第 1-3 行：姓名、入住、搬出） ----------
const names = util[0].slice(7, 16).map(val);
const resId = {};
names.forEach((name, i) => {
  if (!name) return;
  let id = 'r_' + (slug(name) || 'resident-' + (i + 1));        // 中文名转不出英文 id 时用列号
  while (Object.values(resId).includes(id)) id += '-' + (i + 1);  // 两个名字转出同一个 id
  resId[name] = id;
  const isOwner = i === 0;                                  // 第一列是表格的主人（主租客）
  const moveOutCell = util[2][7 + i];
  const moveOut = isOwner || (moveOutCell && moveOutCell.f && /TODAY/i.test(moveOutCell.f)) ? null : day(moveOutCell);
  // 权重：从每列的分摊公式末尾「×2」读出来；第一次出现 ×2 的账单之前按 1 算
  let weights = [];
  const multRows = util.slice(5).map(row => { const f = (row[17 + i] && row[17 + i].f) || ''; const m = f.match(/\)×([\d.]+)\s*$/); return { date: day(row[0]), w: m ? Number(m[1]) : 1 }; });
  const alwaysW = multRows.every(r => r.w === multRows[0].w) ? multRows[0].w : null;
  if (alwaysW && alwaysW !== 1) weights = [{ from: day(util[1][7 + i]), weight: alwaysW }];
  else if (!alwaysW) {
    // 公式里中途才出现 ×2：从第一张 ×2 账单的服务期开始算（私人设置里可以指定日期；之后也能在 app 里改）
    const firstX2 = util.slice(5).find(row => { const f = (row[17 + i] && row[17 + i].f) || ''; return /\)×2\s*$/.test(f); });
    weights = [{ from: config.weightChangeDate || (firstX2 ? day(firstX2[1]) : day(util[1][7 + i])), weight: 2 }];
  }
  put('residents', {
    id, name, moveIn: day(util[1][7 + i]), moveOut, weights, isOwner,
    // 不分摊水电网的人在私人设置里写：'owner'（我承担：照常计人·天、他那份记在主租客名下）或 'excluded'（不参与）
    utilities: Object.fromEntries(['energy', 'water', 'internet'].map(c => [c, (config.participation || {})[name] || 'share'])),
    rent: [],
  });
});

// ---------- PDF 解析结果（可选）：按账单日期配对，补上用量、到期日、分项名称 ----------
const extracts = {};
if (extractDir && fs.existsSync(extractDir)) {
  for (const f of fs.readdirSync(extractDir).filter(f => f.endsWith('.json'))) {
    const arr = JSON.parse(fs.readFileSync(path.join(extractDir, f), 'utf8'));
    // 每条有 draft 就是解析成功了（ok 字段表示和表格是否一致，和表格对不上的恰恰要看）
    extracts[f.replace(/\.json$/, '')] = arr.filter(x => x.draft && x.draft.statementDate);
  }
}
// 日期相近的里面优先取总额也对得上的；strict 时只认总额对得上的（用来判断网费是哪家的）
function findExtract(providerKey, statementDate, periodStart, total, strict = false) {
  const list = extracts[providerKey] || [];
  const near = (a, b, n) => a && b && Math.abs(Date.parse(a) - Date.parse(b)) <= n * 864e5;
  const cands = [...list.filter(x => near(x.draft.statementDate, statementDate, 3)), ...list.filter(x => near(x.draft.periodStart, periodStart, 3))];
  const same = cands.find(x => total != null && Math.abs((x.draft.total || 0) - total) <= 0.01);
  return same || (strict ? null : cands[0] || null);
}

/** 没有 PDF 对得上的网费账单：看日期离哪家的账单更近（私人设置里也可以写 networkSwitchDate） */
function nearestNetwork(date) {
  if (config.networkSwitchDate) return date < config.networkSwitchDate ? 'xfinity' : 'att';
  const dist = k => Math.min(Infinity, ...(extracts[k] || []).map(x => Math.abs(Date.parse(x.draft.statementDate) - Date.parse(date))));
  return dist('xfinity') < dist('att') ? 'xfinity' : 'att';
}

// ---------- 账单 ----------
const CAT = { 'PG&E': 'pge', 'Sunnyvale Utility': 'sunnyvale', 'Network Service': null };
const ITEM_KEYS = { pge: [['electric_delivery', 'Electric Delivery'], ['electric_generation', 'Electric Generation'], ['gas', 'Gas']], sunnyvale: [['water', 'Water'], ['sewer', 'Sewer'], ['garbage', 'Garbage']] };
for (const row of util.slice(5)) {
  const category = val(row[16]);
  if (!category || !(category in CAT)) continue;
  let statementDate = day(row[0]);
  const periodStart = day(row[1]), periodEnd = day(row[2]);
  // 表格里有一行年份写错（账单日期比服务周期早一年），按服务周期改正
  if (statementDate && periodStart && Date.parse(periodStart) - Date.parse(statementDate) > 200 * 864e5) {
    const fixed = String(Number(statementDate.slice(0, 4)) + 1) + statementDate.slice(4);
    warnings.push(`账单日期 ${statementDate} 改成 ${fixed}（服务周期 ${periodStart} → ${periodEnd}）`);
    statementDate = fixed;
  }
  const total = num(row[3]);
  let prov = CAT[category];
  if (!prov) prov = findExtract('xfinity', statementDate, periodStart, total, true) ? 'xfinity' : findExtract('att', statementDate, periodStart, total, true) ? 'att' : nearestNetwork(statementDate);
  const parts = [num(row[4]), num(row[5]), num(row[6])];
  const items = ITEM_KEYS[prov] ? ITEM_KEYS[prov].map(([key, label], k) => ({ key, label, amount: parts[k] })).filter(x => x.amount != null) : [{ key: 'internet', label: 'Internet', amount: total }];
  const shares = {};
  names.forEach((n, i) => { const v = num(row[7 + i]); if (n && v) shares[resId[n]] = v; });
  const ex = findExtract(prov, statementDate, periodStart, total);
  const bill = {
    id: `b_${prov}_${statementDate}`, providerId: 'p_' + prov, statementDate, periodStart, periodEnd,
    ...(PROVIDERS[prov].periodConvention === 'inclusive' ? { endInclusive: true } : {}),
    dueDate: ex ? ex.draft.dueDate || null : null, total, items,
    usage: ex ? ex.draft.usage || [] : [],
    allocation: { mode: 'locked', shares },
    source: { method: 'import', file: ex ? path.basename(ex.file) : null },
    note: '',
  };
  if (ex && Math.abs((ex.draft.total || 0) - (total || 0)) <= 0.01 && ex.draft.periodStart && (ex.draft.periodStart !== periodStart || ex.draft.periodEnd !== periodEnd)) {
    // 金额一样、服务周期不一样：表格里抄错了周期（比如照抄了上一行），以账单上印的为准
    warnings.push(`${prov} ${statementDate}: 服务周期按 PDF 改成 ${ex.draft.periodStart} → ${ex.draft.periodEnd}（表格写 ${periodStart} → ${periodEnd}）`);
    bill.periodStart = ex.draft.periodStart; bill.periodEnd = ex.draft.periodEnd;
  }
  if (ex) {
    // 用 PDF 里的分项名称和更细的分项（金额以表格为准；总额对不上时记一条提醒）
    if (Math.abs((ex.draft.total || 0) - (total || 0)) > 0.01) warnings.push(`${prov} ${statementDate}: 表格总额 ${total}，PDF ${ex.draft.total}`);
    else if (ex.draft.items && ex.draft.items.length) bill.items = ex.draft.items;
  }
  if (state.data.bills[bill.id]) { bill.id += '_' + periodStart; }
  put('bills', bill);
}

// ---------- 房租：表格里只有「已交」的勾，没有金额 ----------
const rentNames = rentT.length ? rentT[0].map(val) : [];
for (const row of rentT.slice(1)) {
  const label = val(row[1]);
  const m = typeof label === 'string' && label.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})/);
  if (!m) continue;
  const periodStart = `20${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  rentNames.forEach((n, ci) => {
    if (!n || val(row[ci]) !== true || !resId[n]) return;
    put('rents', { id: `rent_${resId[n]}_${periodStart}`, residentId: resId[n], periodStart, amount: null, paid: true, paidDate: null, method: null, note: '' });
  });
}

// 开账期：每位还在住的室友最后打勾那期的下一期，取最早的一个（谁的房租还没交，就从那期开始在 app 里收）
const nextKey = k => { let [y, m] = k.split('-').map(Number); m += 1; if (m > 12) { m = 1; y += 1; } return `${y}-${String(m).padStart(2, '0')}`; };
const ticks = Object.values(state.data.rents);
const current = Object.values(state.data.residents).filter(r => !r.isOwner && !r.moveOut);
const perResident = current.map(r => ({ r, last: ticks.filter(x => x.residentId === r.id).map(x => x.periodStart.slice(0, 7)).sort().pop() }));
const lastAny = ticks.map(r => r.periodStart.slice(0, 7)).sort().pop();
const starts = perResident.filter(x => x.last).map(x => nextKey(x.last));
const lastPaid = starts.length ? starts.sort()[0] : lastAny ? nextKey(lastAny) : null;
for (const x of perResident) if (!x.last) warnings.push(`${x.r.name} 在房租表里没有打过勾：开账期 ${lastPaid || '—'} 之前没交的房租不会计入，请在 app 里用「加调整 → 期初余额」补上`);
state.settings = { rentCycleDay: 16, currency: 'USD', graceDays: 3, prorate: 'daily' };
if (config.propertyName) state.settings.propertyName = config.propertyName;
if (lastPaid) state.settings.ledgerStart = lastPaid;
state.settingsAt = Object.fromEntries(Object.keys(state.settings).map(k => [k, IMPORTED]));
fs.writeFileSync(outPath, JSON.stringify({ app: 'house-ledger', kind: 'import', v: 1, createdAt: new Date().toISOString(), state }, null, 1));
const count = c => Object.keys(state.data[c]).length;
console.log(`residents ${count('residents')}, providers ${count('providers')}, bills ${count('bills')}, rent records ${count('rents')}`);
console.log('bills with PDF data:', Object.values(state.data.bills).filter(b => b.source.file).length);
console.log('ledgerStart:', state.settings.ledgerStart || '(none)');
if (warnings.length) console.log('warnings:\n  ' + warnings.join('\n  '));
