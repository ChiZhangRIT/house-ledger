// 收款相关的面板：记收款、加调整、导出明细、某人某期的明细
import { h, openSheet, copyText, signButton } from '../ui/dom.js';
import { t, money, date, period, getLang } from '../i18n.js';
import { newId } from '../core/store.js';
import { addDays, isISODate } from '../core/dates.js';
import { buildRentLedger, rentPeriodsFor, rentReceiptChanges } from '../core/rent.js';
import { openRentPeriod, rentRange } from './rentHistory.js';
import { buildStatement } from '../core/statement.js';
import { parseAmount } from '../ui/parse.js';
import { residentName } from './parts.js';

export const METHODS = ['zelle', 'venmo', 'cash', 'check', 'other'];
const lastMethod = (ctx, rid) => { const p = ctx.D.payments.find(x => x.residentId === rid && x.method); return p ? p.method : 'zelle'; };
const rentPeople = ctx => ctx.D.residents.filter(r => !r.isOwner).sort((a, b) => Number(!!a.moveOut && a.moveOut <= ctx.D.today) - Number(!!b.moveOut && b.moveOut <= ctx.D.today) || b.moveIn.localeCompare(a.moveIn));

/** 收款先明确覆盖租期，再记录实际到账；可分次，也可提前付。 */
export function openPayment(ctx, { residentId, amount, rentId, payment, refund = false, onSave } = {}) {
  let L;
  const people = rentPeople(ctx);
  let rid = payment?.residentId || residentId || people[0]?.id, selected = payment?.rentId || rentId || '';
  let rows = [], chosen;
  const initialAmount = payment?.amount ?? amount ?? null;
  const f = { amount: initialAmount == null ? null : Math.abs(initialAmount), refund: initialAmount < 0 || refund, date: payment ? payment.date || '' : ctx.D.today,
    dateUnavailable: payment?.dateUnavailable === true, method: payment ? (payment.method || 'other') : lastMethod(ctx, rid), note: payment?.note || '' };
  const prevEl = h('p.note'), datesEl = h('p'), quick = h('div.chips');
  const amountLabel = h('span.field-label'), dateLabel = h('span.field-label');
  const dateInput = h('input', { type: 'date', value: f.dateUnavailable ? '' : f.date, disabled: f.dateUnavailable, oninput: e => { f.date = e.target.value; } });
  const dateHint = h('p.note', { hidden: !f.dateUnavailable }, t('rent.dateUnavailableHint'));
  const dateOption = h('label.check-line', null, h('input', { type: 'checkbox', checked: f.dateUnavailable, onchange: e => {
    f.dateUnavailable = e.target.checked; dateInput.disabled = f.dateUnavailable; dateInput.value = f.dateUnavailable ? '' : f.date; dateHint.hidden = !f.dateUnavailable;
  } }), h('span', null, t('rent.dateUnavailableOption')));
  const amtIn = h('input.big-amt', { inputmode: 'decimal', value: f.amount ?? '', oninput: e => { f.amount = parseAmount(e.target.value); preview(); } });
  const preview = () => {
    amountLabel.textContent = t(f.refund ? 'rent.refundAmount' : 'rent.receivedAmount');
    dateLabel.textContent = t(f.refund ? 'rent.refundDate' : 'rent.receivedDate');
    chosen = rows.find(x => x.id === selected);
    datesEl.textContent = chosen ? t('rent.selectedPeriod', { due: chosen.dueDate || '—', start: chosen.periodStart || '—', end: chosen.periodEnd || '—' }) : t('rent.unassignedHint');
    const item = L.people[rid]?.items.find(x => x.rentId === selected);
    const received = (L.people[rid]?.payments || []).filter(x => x.rentId === selected).reduce((sum, x) => sum + x.amount, 0);
    const expected = item ? (item.unknown ? null : item.cents / 100) : chosen?.amount;
    const incomplete = L.people[rid]?.incompleteReceipts.some(x => x.rentId === selected) || (payment && f.amount == null);
    const left = chosen && expected != null && !incomplete ? Math.round((expected - received) * 100) / 100 : null;
    quick.replaceChildren(...(left > 0 && !f.refund ? [ h('button.chip', { type: 'button', onclick: () => { f.amount = left; amtIn.value = left.toFixed(2); preview(); } }, t('rent.periodRemaining') + ' ' + money(left))] : []));
    prevEl.hidden = !chosen;
    prevEl.textContent = left == null ? t('rent.receiptOnlyHint') : t('rent.periodBalance', { amount: left - (f.refund ? -1 : 1) * (f.amount || 0) });
  };
  const periodSelect = h('select', { onchange: e => {
    if (e.target.value === 'new') {
      periodSelect.value = selected;
      openRentPeriod(ctx, rid, null, { onSave: rec => { selected = rec?.id || ''; refreshPeriods(); } });
    } else { selected = e.target.value; preview(); }
  } });
  const refreshPeriods = (auto = false) => {
    L = buildRentLedger(payment ? { ...ctx.S, data: { ...ctx.S.data, payments: { ...ctx.S.data.payments, [payment.id]: { ...payment, deleted: true } } } } : ctx.S, ctx.D.today);
    rows = rentPeriodsFor(ctx.S, rid, ctx.D.today);
    if (auto && !selected) selected = rows.find(x => L.people[rid]?.debits.some(d => d.rentId === x.id && d.remaining > 0))?.id || rows.find(x => x.periodEnd >= ctx.D.today)?.id || '';
    periodSelect.replaceChildren(h('option', { value: '', selected: !selected }, t('rent.coverageLater')),
      ...rows.map(x => h('option', { value: x.id, selected: x.id === selected }, rentRange(x) + (x.dueDate ? ' · ' + t('rent.dueShort') + ' ' + x.dueDate : ''))),
      h('option', { value: 'new' }, t('rent.newPeriod')));
    if (selected && !rows.some(x => x.id === selected)) { selected = ''; periodSelect.value = ''; }
    preview();
  };
  const sel = h('select', { onchange: e => { rid = e.target.value; selected = ''; f.method = lastMethod(ctx, rid); refreshPeriods(true); renderMethods(); } }, people.map(r => h('option', { value: r.id, selected: r.id === rid }, r.name)));
  const methods = h('div.chips', { role: 'radiogroup', 'aria-label': t('pay.method') });
  const renderMethods = () => methods.replaceChildren(...METHODS.map(m => h('button.chip' + (f.method === m ? '.on' : ''), { type: 'button', role: 'radio', 'aria-checked': String(f.method === m), onclick: () => { f.method = m; renderMethods(); } }, t('method.' + m))));
  renderMethods(); refreshPeriods(!payment);
  const save = () => {
    const incomplete = payment && (payment.embeddedRentId || payment.confirmationOnly) && f.amount == null && !f.refund;
    if ((!incomplete && (!Number.isFinite(f.amount) || f.amount < 0 || (f.amount === 0 && !payment) || f.amount > 1e7)) || !rid) { amtIn.focus(); return; }
    const receiptDate = f.dateUnavailable ? '' : f.date;
    if (receiptDate && !isISODate(receiptDate)) { prevEl.hidden = false; prevEl.textContent = t('rent.historyError.date'); return; }
    const current = payment && (payment.embeddedRentId ? ctx.S.data.rents[payment.embeddedRentId] : ctx.S.data.payments[payment.id]);
    if (current && current.updatedAt !== payment.updatedAt && !confirm(t(current.deleted ? 'form.deletedElsewhere' : 'form.changedElsewhere'))) return;
    let rec;
    ctx.batch(() => {
      const changes = payment ? rentReceiptChanges(ctx.S, payment) : { receipt: {}, rent: null };
      if (changes.rent) ctx.put('rents', changes.rent);
      if (chosen && !ctx.S.data.rents[chosen.id]) ctx.put('rents', chosen);
      rec = ctx.put('payments', { ...changes.receipt, deleted: undefined, deletedAt: undefined, id: payment?.id || 'pay_' + newId(), purpose: 'rent', residentId: rid, rentId: chosen?.id || null,
        date: receiptDate, dateUnavailable: f.dateUnavailable || undefined, amount: incomplete ? null : f.amount * (f.refund ? -1 : 1), confirmationOnly: incomplete || undefined, method: f.method, note: f.note });
    });
    sheet.close(); onSave?.(rec);
    ctx.toast(rec.amount == null ? t('res.saved') : t('pay.saved', { amount: rec.amount, name: residentName(ctx, rid) }), { action: t('undo'), onAction: () => {
      if (payment) ctx.put('payments', rentReceiptChanges(ctx.S, payment).receipt); else ctx.remove('payments', rec.id);
      onSave?.();
    }, ms: 10000 });
  };
  const sheet = openSheet({ title: t(payment ? 'rent.editReceipt' : f.refund ? 'rent.recordRefund' : 'rent.record'), closeLabel: t('rent.close'),
    body: h('form.form', { onsubmit: e => { e.preventDefault(); save(); } },
      residentId ? h('p', null, residentName(ctx, residentId)) : h('label.field', null, h('span.field-label', null, t('pay.who')), sel),
      h('label.field', null, h('span.field-label', null, t('rent.coverage')), periodSelect), datesEl,
      h('label.field', null, h('span.field-label', null, t('rent.receiptType')), h('select', { onchange: e => { f.refund = e.target.value === 'refund'; preview(); } },
        ['receipt', 'refund'].map(k => h('option', { value: k, selected: f.refund === (k === 'refund') }, t('rent.' + k))))),
      h('label.field', null, amountLabel, amtIn, h('span.hint', null, t('rent.refundHint'))), quick,
      h('div.field-row', null,
        h('div.field', null, h('label.field', null, dateLabel, dateInput), dateOption, dateHint),
        h('div.field', null, h('span.field-label', null, t('pay.method')), methods)),
      h('label.field', null, h('span.field-label', null, t('form.note')), h('input', { value: f.note, placeholder: t('pay.notePh'), oninput: e => { f.note = e.target.value; } })),
      prevEl, h('p.note', null, t('rent.assignmentHint')), h('button', { type: 'submit', hidden: true })),
    foot: [payment ? h('button.btn.danger', { type: 'button', onclick: () => deleteRentPayment(ctx, payment, () => { sheet.close(); onSave?.(); }) }, t('bill.delete')) : null,
      h('span.sp'), h('button.btn', { type: 'button', onclick: () => sheet.close() }, t('cancel')), h('button.btn.primary', { type: 'button', onclick: save }, t('pay.save'))].filter(Boolean),
  });
}

export function deleteRentPayment(ctx, payment, onChange) {
  const confirmation = openSheet({ title: t('bill.delete'), closeLabel: t('rent.close'), body: h('p', null, t('pay.deleteConfirm')),
    foot: [h('span.sp'), h('button.btn', { type: 'button', onclick: () => confirmation.close() }, t('cancel')),
      h('button.btn.danger', { type: 'button', onclick: () => {
        let previous;
        ctx.batch(() => {
          const changes = rentReceiptChanges(ctx.S, payment);
          if (changes.rent) ctx.put('rents', changes.rent);
          if (!ctx.S.data.payments[payment.id]) ctx.put('payments', changes.receipt);
          previous = ctx.remove('payments', payment.id);
        });
        confirmation.close(); onChange?.();
        ctx.toast(t('pay.deleted'), { action: t('undo'), onAction: () => { ctx.put('payments', previous); onChange?.(); }, ms: 10000 });
      } }, t('bill.delete'))] });
}

/** 加一笔调整：正数加收，负数减免；期初余额用 kind = opening */
export function openAdjustment(ctx, { residentId, rentId, kind = 'other', adjustment, onSave } = {}) {
  const people = rentPeople(ctx);
  const f = { residentId: adjustment?.residentId || residentId || people[0]?.id, amount: adjustment?.amount ?? null, kind: adjustment?.kind || kind, label: adjustment?.label || (kind === 'opening' ? t('adj.kind.opening') : ''), rentId: adjustment?.rentId || rentId || '' };
  const err = h('p.err', { hidden: true });
  const save = () => {
    if (!Number.isFinite(f.amount) || !f.amount || Math.abs(f.amount) > 1e7) { err.textContent = t('pay.badAmount'); err.hidden = false; return; }
    if (!f.label.trim()) { err.textContent = t('adj.needLabel'); err.hidden = false; return; }
    const chosen = rentPeriodsFor(ctx.S, f.residentId, ctx.D.today).find(x => x.id === f.rentId);
    if (!chosen) { err.textContent = t('rent.adjustmentPeriodHint'); err.hidden = false; return; }
    let rec;
    ctx.batch(() => {
      if (!ctx.S.data.rents[chosen.id]) ctx.put('rents', chosen);
      rec = ctx.put('adjustments', { ...adjustment, id: adjustment?.id || 'adj_' + newId(), purpose: 'rent', residentId: f.residentId, rentId: chosen.id, date: adjustment?.date || ctx.D.today, amount: f.amount, kind: f.kind, label: f.label.trim(), collectPeriod: (chosen.periodStart || chosen.legacyDate || chosen.paidDate || chosen.dueDate || ctx.D.today).slice(0, 7) });
    });
    sheet.close(); onSave?.(rec);
    ctx.toast(t('adj.saved'), { action: t('undo'), onAction: () => { if (adjustment) ctx.put('adjustments', adjustment); else ctx.remove('adjustments', rec.id); onSave?.(); }, ms: 10000 });
  };
  const periodSelect = h('select', { onchange: e => { f.rentId = e.target.value; err.hidden = true; } });
  const updatePeriods = () => periodSelect.replaceChildren(h('option', { value: '', selected: !f.rentId }, t('rent.selectRecord')),
    ...rentPeriodsFor(ctx.S, f.residentId, ctx.D.today).map(x => h('option', { value: x.id, selected: x.id === f.rentId }, rentRange(x))));
  updatePeriods();
  const sheet = openSheet({
    title: t('adj.title'), closeLabel: t('rent.close'),
    body: h('div.form', null,
      h('label.field', null, h('span.field-label', null, t('pay.who')), h('select', { onchange: e => { f.residentId = e.target.value; f.rentId = ''; updatePeriods(); } }, people.map(r => h('option', { value: r.id, selected: r.id === f.residentId }, r.name)))),
      h('label.field', null, h('span.field-label', null, t('adj.kind')), h('select', { onchange: e => { f.kind = e.target.value; } },
        ['opening', 'discount', 'charge', 'writeoff', 'other'].map(k => h('option', { value: k, selected: k === f.kind }, t('adj.kind.' + k))))),
      h('label.field', null, h('span.field-label', null, t('pay.amount')), (() => { const inp = h('input.big-amt', { inputmode: 'decimal', value: f.amount ?? '', placeholder: '0.00', oninput: e => { f.amount = parseAmount(e.target.value); } }); return h('div.amt-line', null, inp, signButton(inp)); })(), h('span.hint', null, t('adj.amountHint'))),
      h('label.field', null, h('span.field-label', null, t('adj.label')), h('input', { value: f.label, oninput: e => { f.label = e.target.value; } })),
      h('label.field', null, h('span.field-label', null, t('rent.adjustmentPeriod')), periodSelect),
      h('button.link-btn', { type: 'button', onclick: () => {
        const selected = rentPeriodsFor(ctx.S, f.residentId, ctx.D.today).find(x => x.id === f.rentId);
        openRentPeriod(ctx, f.residentId, selected, { onSave: rec => { f.rentId = rec?.id || ''; updatePeriods(); err.hidden = true; } });
      } }, t('rent.editOrAddPeriod')),
      h('p.note', null, t('rent.adjustmentPeriodHint')),
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
