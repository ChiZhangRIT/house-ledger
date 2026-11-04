// 收款相关的面板：记收款、加调整、导出明细、某人某期的明细
import { h, openSheet, copyText, signButton } from '../ui/dom.js';
import { t, money, date, period, getLang } from '../i18n.js';
import { newId } from '../core/store.js';
import { addDays } from '../core/dates.js';
import { buildStatement } from '../core/statement.js';
import { parseAmount } from '../ui/parse.js';
import { residentName } from './parts.js';

export const METHODS = ['zelle', 'venmo', 'cash', 'check', 'other'];
const lastMethod = (ctx, rid) => { const p = ctx.D.payments.find(x => x.residentId === rid && x.method); return p ? p.method : 'zelle'; };
const rentPeople = ctx => ctx.D.residents.filter(r => !r.isOwner).sort((a, b) => Number(!!a.moveOut && a.moveOut <= ctx.D.today) - Number(!!b.moveOut && b.moveOut <= ctx.D.today) || b.moveIn.localeCompare(a.moveIn));

/** 记一笔收款（金额预填当前欠款；负数是退款） */
export function openPayment(ctx, { residentId, amount, periodKey } = {}) {
  const L = ctx.D.ledger;
  const people = rentPeople(ctx);
  let rid = residentId || (people[0] && people[0].id);
  const f = { amount: amount != null ? amount : Math.max(0, (L.people[rid] || {}).outstanding || 0), date: ctx.D.today, method: lastMethod(ctx, rid), note: '' };
  const amtIn = h('input.big-amt', { inputmode: 'decimal', value: f.amount ? f.amount.toFixed(2) : '', oninput: e => { f.amount = parseAmount(e.target.value); preview(); } });
  const prevEl = h('p.note');
  const quick = h('div.chips');
  const methods = h('div.chips', { role: 'radiogroup', 'aria-label': t('pay.method') });
  const renderMethods = () => methods.replaceChildren(...METHODS.map(m => h('button.chip' + (f.method === m ? '.on' : ''), { type: 'button', role: 'radio', 'aria-checked': String(f.method === m), onclick: () => { f.method = m; renderMethods(); } }, t('method.' + m))));
  const renderQuick = () => {
    const p = L.people[rid] || {}, P = periodKey ? L.period(periodKey).people[rid] : L.period(L.current).people[rid];
    const opts = [[t('pay.all'), p.outstanding], P && P.due > 0 ? [t('pay.thisPeriod'), P.due] : null].filter(x => x && x[1] > 0.005);
    quick.replaceChildren(...opts.map(([lab, v]) => h('button.chip', { type: 'button', onclick: () => { f.amount = v; amtIn.value = v.toFixed(2); preview(); } }, lab + ' ' + money(v))));
  };
  const preview = () => {
    const p = L.people[rid] || { balance: 0 };
    const after = Math.round((p.balance - (f.amount || 0)) * 100) / 100;
    prevEl.textContent = f.amount == null ? t('pay.badAmount') : !p.items?.length || p.unknownRent?.length ? t('rent.receiptOnlyHint') : after > 0.005 ? t('pay.after', { amount: after }) : after < -0.005 ? t('pay.overpay', { amount: -after }) : t('pay.settles');
  };
  const sel = h('select', { onchange: e => { rid = e.target.value; f.method = lastMethod(ctx, rid); const o = Math.max(0, (L.people[rid] || {}).outstanding || 0); f.amount = o; amtIn.value = o ? o.toFixed(2) : ''; renderMethods(); renderQuick(); preview(); } },
    people.map(r => h('option', { value: r.id, selected: r.id === rid }, r.name)));
  renderMethods(); renderQuick(); preview();
  const save = () => {
    if (f.amount == null || !f.amount || !rid) { amtIn.focus(); return; }
    const rec = ctx.put('payments', { id: 'pay_' + newId(), purpose: 'rent', residentId: rid, date: f.date || ctx.D.today, amount: f.amount, method: f.method, note: f.note });
    sheet.close();
    const p = ctx.D.ledger.people[rid] || {};
    const msg = t('pay.saved', { amount: rec.amount, name: residentName(ctx, rid) }) + (p.items?.length && !p.unknownRent?.length && Math.abs(p.balance) <= 0.005 ? ' · ' + t('st.settled') : '');
    ctx.toast(msg, { action: t('undo'), onAction: () => ctx.remove('payments', rec.id), ms: 10000 });
  };
  const sheet = openSheet({
    title: t('pay.title'),
    body: h('form.form', { onsubmit: e => { e.preventDefault(); save(); } },
      h('label.field', null, h('span.field-label', null, t('pay.who')), sel),
      h('label.field', null, h('span.field-label', null, t('pay.amount')), h('div.amt-line', null, amtIn, signButton(amtIn)), h('span.hint', null, t('pay.refundHint'))),
      quick,
      h('div.field-row', null,
        h('label.field', null, h('span.field-label', null, t('pay.date')), h('input', { type: 'date', value: f.date, oninput: e => { f.date = e.target.value; } })),
        h('div.field', null, h('span.field-label', null, t('pay.method')), methods)),
      h('label.field', null, h('span.field-label', null, t('form.note')), h('input', { value: '', placeholder: t('pay.notePh'), oninput: e => { f.note = e.target.value; } })),
      prevEl, h('p.note', null, t('pay.fifo')),
      h('button', { type: 'submit', hidden: true })),
    foot: [h('span.sp'), h('button.btn', { type: 'button', onclick: () => sheet.close() }, t('cancel')), h('button.btn.primary', { type: 'button', onclick: save }, t('pay.save'))],
  });
  setTimeout(() => amtIn.focus(), 50);
}

/** 加一笔调整：正数加收，负数减免；期初余额用 kind = opening */
export function openAdjustment(ctx, { residentId, kind = 'other' } = {}) {
  const L = ctx.D.ledger;
  const people = rentPeople(ctx);
  const f = { residentId: residentId || (people[0] && people[0].id), amount: null, kind, label: kind === 'opening' ? t('adj.kind.opening') : '', collectPeriod: kind === 'opening' && ctx.S.settings.ledgerStart ? ctx.S.settings.ledgerStart : L.current };
  const err = h('p.err', { hidden: true });
  const save = () => {
    if (f.amount == null || !f.amount) { err.textContent = t('pay.badAmount'); err.hidden = false; return; }
    if (!f.label.trim()) { err.textContent = t('adj.needLabel'); err.hidden = false; return; }
    const rec = ctx.put('adjustments', { id: 'adj_' + newId(), purpose: 'rent', residentId: f.residentId, date: ctx.D.today, amount: f.amount, kind: f.kind, label: f.label.trim(), collectPeriod: f.collectPeriod });
    sheet.close();
    ctx.toast(t('adj.saved'), { action: t('undo'), onAction: () => ctx.remove('adjustments', rec.id), ms: 10000 });
  };
  const periods = periodChoices(ctx);
  const sheet = openSheet({
    title: t('adj.title'),
    body: h('div.form', null,
      h('label.field', null, h('span.field-label', null, t('pay.who')), h('select', { onchange: e => { f.residentId = e.target.value; } }, people.map(r => h('option', { value: r.id, selected: r.id === f.residentId }, r.name)))),
      h('label.field', null, h('span.field-label', null, t('adj.kind')), h('select', { onchange: e => { f.kind = e.target.value; } },
        ['opening', 'discount', 'charge', 'writeoff', 'other'].map(k => h('option', { value: k, selected: k === f.kind }, t('adj.kind.' + k))))),
      h('label.field', null, h('span.field-label', null, t('pay.amount')), (() => { const inp = h('input.big-amt', { inputmode: 'decimal', placeholder: '0.00', oninput: e => { f.amount = parseAmount(e.target.value); } }); return h('div.amt-line', null, inp, signButton(inp)); })(), h('span.hint', null, t('adj.amountHint'))),
      h('label.field', null, h('span.field-label', null, t('adj.label')), h('input', { value: f.label, oninput: e => { f.label = e.target.value; } })),
      h('label.field', null, h('span.field-label', null, t('form.collectPeriod')), h('select', { onchange: e => { f.collectPeriod = e.target.value; } },
        periods.map(k => h('option', { value: k, selected: k === f.collectPeriod }, periodLabel(ctx, k))))),
      err),
    foot: [h('span.sp'), h('button.btn', { type: 'button', onclick: () => sheet.close() }, t('cancel')), h('button.btn.primary', { type: 'button', onclick: save }, t('save'))],
  });
}

/** 可选的收款期：开账期（或去年）到下两期 */
export function periodChoices(ctx) {
  const L = ctx.D.ledger, out = [];
  let k = ctx.S.settings.ledgerStart || L.current;
  for (let i = 0; i < 12 && k > L.current; i++) k = prevMonthKey(k);
  const stop = nextMonthKey(nextMonthKey(L.current));
  for (let n = 0; k <= stop && n < 240; n++, k = nextMonthKey(k)) out.push(k);
  return out;
}
const nextMonthKey = k => { let [y, m] = k.split('-').map(Number); m++; if (m > 12) { m = 1; y++; } return `${y}-${String(m).padStart(2, '0')}`; };
const prevMonthKey = k => { let [y, m] = k.split('-').map(Number); m--; if (m < 1) { m = 12; y--; } return `${y}-${String(m).padStart(2, '0')}`; };
export function periodLabel(ctx, k) {
  const P = ctx.D.ledger.period(k);
  return t('period.title', { month: t('period.m', { m: Number(k.slice(5)), y: k.slice(0, 4) }), range: period(P.start, addDays(P.end, -1)) });
}

/** 导出明细：选人、选期、选语言；复制 / 分享 / 打印，并记一条「已发送」 */
export function openStatement(ctx, { residentId, periodKey } = {}) {
  const L = ctx.D.ledger;
  const people = ctx.D.residents.filter(r => !r.isOwner);
  const prefs = ctx.L.prefs;
  const f = { residentId: residentId || (people[0] && people[0].id), period: periodKey || L.current, lang: prefs.stLang || (getLang() === 'en' ? 'en' : 'zh'), formula: prefs.stFormula !== false, usage: !!prefs.stUsage };
  const pre = h('pre.statement');
  let current = null;
  const pay = ctx.S.settings.payInstructions || '';
  const update = () => {
    current = buildStatement({ state: ctx.S, ledger: L, residentId: f.residentId, period: f.period, lang: f.lang, today: ctx.D.today, showFormula: f.formula, showUsage: f.usage, payInstructions: pay });
    pre.textContent = current.text;
  };
  const record = (channel) => ctx.put('exports', { id: 'exp_' + newId(), residentId: f.residentId, period: f.period, lang: f.lang, channel, createdAt: Date.now(), totalDue: current.totalDue, lines: current.lines });
  const opt = (label, key) => h('label.check-line', null, h('input', { type: 'checkbox', checked: f[key], onchange: e => { f[key] = e.target.checked; ctx.setPref(key === 'formula' ? 'stFormula' : 'stUsage', e.target.checked); update(); } }), h('span', null, label));
  update();
  const sheet = openSheet({
    title: t('st.title'), wide: true,
    body: h('div.form', null,
      h('div.field-row', null,
        h('label.field', null, h('span.field-label', null, t('pay.who')), h('select', { onchange: e => { f.residentId = e.target.value; update(); } }, people.map(r => h('option', { value: r.id, selected: r.id === f.residentId }, r.name)))),
        h('label.field', null, h('span.field-label', null, t('form.collectPeriod')), h('select', { onchange: e => { f.period = e.target.value; update(); } }, periodChoices(ctx).map(k => h('option', { value: k, selected: k === f.period }, periodLabel(ctx, k))))),
        h('label.field', null, h('span.field-label', null, t('st.lang')), h('select', { onchange: e => { f.lang = e.target.value; ctx.setPref('stLang', f.lang); update(); } },
          h('option', { value: 'zh', selected: f.lang === 'zh' }, '中文'), h('option', { value: 'en', selected: f.lang === 'en' }, 'English')))),
      h('div.row', null, opt(t('st.formula'), 'formula'), opt(t('st.usage'), 'usage')),
      pay ? null : h('p.note', null, t('st.noPay')),
      pre),
    foot: [
      h('button.btn', { type: 'button', onclick: () => { record('print'); printText(current.text); } }, t('st.print')),
      navigator.share ? h('button.btn', { type: 'button', onclick: async () => { try { await navigator.share({ text: current.text }); record('share'); } catch (e) { /* 用户取消 */ } } }, t('st.share')) : null,
      h('span.sp'),
      h('button.btn.primary', { type: 'button', onclick: async () => { if (await copyText(current.text)) { record('copy'); ctx.toast(t('st.copied')); } } }, t('st.copy'))].filter(Boolean),
  });
}

/** 打印：开一个只有明细的窗口（系统打印面板里可以「存储为 PDF」） */
function printText(text) {
  const w = window.open('', '_blank');
  if (!w) return;
  w.document.title = text.split('\n')[0];
  const pre = w.document.createElement('pre');
  pre.textContent = text;
  pre.style.cssText = 'font: 13px/1.6 -apple-system, "PingFang SC", sans-serif; white-space: pre-wrap; margin: 24px;';
  w.document.body.appendChild(pre);
  w.focus();
  setTimeout(() => w.print(), 100);
}

/** 某人某期的明细小窗：房租、各账单份额、调整，以及抵到这一期的钱 */
export function openPeriodCell(ctx, residentId, key) {
  const L = ctx.D.ledger, P = L.period(key), me = P.people[residentId];
  const p = L.people[residentId];
  const rows = (me ? me.items : []).map(it => {
    const deb = p.debits.find(d => d.ref === it.ref);
    const label = it.type === 'rent' ? t('ledger.rent') + (it.prorated ? ' · ' + t('ledger.prorated', { n: it.days, d: it.periodDays }) : '') + (it.unknown ? ' · ' + t('ledger.unknownRent') : '')
      : it.type === 'bill' ? billLabel(ctx, it.billId) : (it.label || t('adj.kind.other'));
    return h('tr', null, h('th', null, label), h('td.num', null, it.unknown ? '—' : money(it.cents / 100)),
      h('td.num.muted', null, deb ? (deb.remaining ? t('ledger.left', { amount: deb.remaining / 100 }) : '✓ ' + (deb.paidOn ? date(deb.paidOn, 'short') : '')) : ''));
  });
  const sheet = openSheet({
    title: residentName(ctx, residentId) + ' · ' + periodLabel(ctx, key),
    body: h('div', null, rows.length ? h('table.data-table', null, h('tbody', null, rows)) : h('p.muted', null, t('ledger.nothing')),
      me ? h('p', null, t('ledger.cellSum', { total: me.E, paid: me.C })) : null,
      me ? h('p.note', null, t('ledger.cellDue', { previous: me.previous, paid: me.paidSince, due: me.due })) : null),
    foot: [h('span.sp'),
      h('button.btn.primary', { type: 'button', onclick: () => { sheet.close(); openPayment(ctx, { residentId, periodKey: key }); } }, t('pay.title'))],
  });
}

export function billLabel(ctx, billId) {
  const b = ctx.S.data.bills[billId];
  if (!b) return billId;
  const p = ctx.D.providers[b.providerId] || { name: '?' };
  return `${p.name} ${period(b.periodStart, b.periodEnd)}`;
}
