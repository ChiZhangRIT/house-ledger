// 给室友的明细（纯文字，适合贴进 iMessage / 微信，也能打印）。语言和界面语言分开选。
// 数字和收款页一致：上期结欠 + 本期费用 − 本期已付 = 应付合计（见 ledger.js 的 period()）。
// 只写这个人自己的天数和比例，不写其他住户的名字（只写「全屋 N 人·天」）。
import { billShares, billDays, covEnd } from './analytics.js';
import { overlapDays, addDays } from './dates.js';
import { weightOn } from './split.js';

const W = {
  zh: {
    title: (p, range, name) => `${p} · ${range} 明细 · ${name}`,
    previous: '上期结欠', rent: (r) => `房租 ${r}`, prorated: (n, d) => `（住 ${n}/${d} 天，按天折算）`,
    bill: (prov, range, days, total) => `${prov} ${range}（${days} 天）共 ${total}`,
    formula: (d, w, wd, all, pct) => `你住 ${d} 天 × ${w} = ${wd} ÷ 全屋 ${all} 人·天 = ${pct}`,
    formulaPd: (d, wd, all, pct) => `你住 ${d} 天，计 ${wd} 人·天 ÷ 全屋 ${all} 人·天 = ${pct}`,
    usage: (s) => `用量：${s}`, adj: (l) => `调整：${l}`, paid: '本期已付', total: '应付合计', dueBy: (d) => `请于 ${d} 前付款`,
    credit: '（预付余额，会自动抵以后的费用）', settled: '已结清，谢谢！', pay: '付款方式：', generated: (d) => `生成于 ${d}`,
    period: (m) => `${m}期`, month: (y, m) => `${y}年${m}月`, rentUnknown: '房租（金额待定）',
  },
  'zh-Hant-TW': {
    title: (p, range, name) => `${p} · ${range} 明細 · ${name}`,
    previous: '上期未繳', rent: r => `租金 ${r}`, prorated: (n, d) => `（居住 ${n}/${d} 天，按日比例計算）`,
    bill: (prov, range, days, total) => `${prov} ${range}（${days} 天）合計 ${total}`,
    formula: (d, w, wd, all, pct) => `居住 ${d} 天 × ${w} = ${wd} ÷ 全屋 ${all} 人日 = ${pct}`,
    formulaPd: (d, wd, all, pct) => `居住 ${d} 天，計 ${wd} 人日 ÷ 全屋 ${all} 人日 = ${pct}`,
    usage: s => `用量：${s}`, adj: l => `調整：${l}`, paid: '本期已付', total: '應付合計', dueBy: d => `請於 ${d} 前付款`,
    credit: '（預付餘額，會自動折抵之後的費用）', settled: '已結清，謝謝！', pay: '付款方式：', generated: d => `建立日期：${d}`,
    period: m => `${m}期`, month: (y, m) => `${y}年${m}月`, rentUnknown: '租金（金額待確認）',
  },
  en: {
    title: (p, range, name) => `${p} statement (${range}) · ${name}`,
    previous: 'Previous balance', rent: (r) => `Rent ${r}`, prorated: (n, d) => ` (${n} of ${d} days, prorated)`,
    bill: (prov, range, days, total) => `${prov} ${range} (${days} days), total ${total}`,
    formula: (d, w, wd, all, pct) => `you: ${d} days × ${w} = ${wd} ÷ ${all} person-days in the house = ${pct}`,
    formulaPd: (d, wd, all, pct) => `you: ${d} days, ${wd} person-days ÷ ${all} person-days in the house = ${pct}`,
    usage: (s) => `Usage: ${s}`, adj: (l) => `Adjustment: ${l}`, paid: 'Paid this period', total: 'Amount due', dueBy: (d) => `Please pay by ${d}`,
    credit: ' (credit, applied to future charges)', settled: 'All settled — thank you!', pay: 'How to pay: ', generated: (d) => `Generated ${d}`,
    period: (m) => `${m}`, month: (y, m) => `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]} ${y}`, rentUnknown: 'Rent (amount to be confirmed)',
  },
};
const money = v => (v < 0 ? '−' : '') + '$' + Math.abs(v).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const md = (iso) => { const [, m, d] = iso.split('-').map(Number); return `${m}/${d}`; };
const range = (a, b) => `${md(a)}–${md(b)}`;

/**
 * @param o { state, ledger, residentId, period, lang: 'zh'|'zh-Hant-TW'|'en', today, showFormula = true, showUsage = false, payInstructions }
 * @returns {{ text: string, lines: Array<{ ref, label, amount }>, totalDue: number }}
 */
export function buildStatement(o) {
  const w = W[o.lang] || W.zh;
  const r = o.state.data.residents[o.residentId];
  const P = o.ledger.period(o.period);
  const me = P.people[o.residentId];
  const [y, m] = o.period.split('-').map(Number);
  const residents = Object.values(o.state.data.residents).filter(x => !x.deleted);
  const out = [], lines = [];
  const row = (label, amount) => `${label}${amount == null ? '' : '  ' + money(amount)}`;
  out.push(w.title(w.period(w.month(y, m)), range(P.start, addDays(P.end, -1)), r.shortName || r.name));
  out.push('');
  out.push(row(w.previous, me.previous));
  for (const it of me.items) {
    if (it.type === 'rent') {
      if (it.unknown) { out.push(w.rentUnknown); continue; }
      out.push(row(w.rent(range(P.start, addDays(P.end, -1))) + (it.prorated && it.days < it.periodDays ? w.prorated(it.days, it.periodDays) : ''), it.cents / 100));
      lines.push({ ref: it.ref, label: 'rent', amount: it.cents / 100 });
    } else if (it.type === 'bill') {
      const b = o.state.data.bills[it.billId];
      const p = o.state.data.providers[b.providerId] || { name: '?' };
      out.push(w.bill(p.name, range(b.periodStart, b.periodEnd), billDays(b), money(b.total)));
      const sh = billShares(b, p, residents);
      const basis = (sh.basis || []).find(x => x.id === o.residentId);
      const totalPD = (sh.basis || []).reduce((a, x) => a + x.personDays, 0);
      if (o.showFormula !== false && basis && totalPD) {
        const days = overlapDays(r.moveIn, r.moveOut || '9999-12-31', b.periodStart, covEnd(b));
        const wt = weightOn(r, r.moveIn > b.periodStart ? r.moveIn : b.periodStart);
        const pctTxt = (basis.personDays / totalPD * 100).toFixed(2) + '%';
        out.push('  ' + row(days * wt === basis.personDays ? w.formula(days, wt, basis.personDays, totalPD, pctTxt) : w.formulaPd(days, basis.personDays, totalPD, pctTxt), it.cents / 100));
      } else out.push('  ' + row('', it.cents / 100).trim());
      if (o.showUsage && (b.usage || []).length) out.push('  ' + w.usage(b.usage.map(u => `${u.amount} ${u.unit}`).join(', ')));
      lines.push({ ref: it.ref, label: p.name, amount: it.cents / 100 });
    } else {
      const a = o.state.data.adjustments[it.adjId];
      out.push(row(w.adj((a && a.label) || ''), it.cents / 100));
      lines.push({ ref: it.ref, label: 'adj', amount: it.cents / 100 });
    }
  }
  if (me.paidSince) out.push(row(w.paid, -me.paidSince));
  out.push('');
  const due = me.due;
  if (due > 0.005) out.push(`${w.total} ${money(due)} · ${w.dueBy(md(addDays(P.start, Number(o.state.settings.graceDays ?? 3) || 0)))}`);
  else if (due < -0.005) out.push(`${w.total} ${money(due)}${w.credit}`);
  else out.push(`${w.total} ${money(0)} · ${w.settled}`);
  if (o.payInstructions) out.push(w.pay + o.payInstructions);
  out.push(w.generated(o.today));
  return { text: out.join('\n'), lines, totalDue: due };
}
