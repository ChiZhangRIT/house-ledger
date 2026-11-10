// 收款相关的面板：记收款、加调整、导出明细、某人某期的明细
import { h, openSheet, copyText, signButton } from '../ui/dom.js';
import { t, money, date, period, getLang, LANG_LABELS } from '../i18n.js';
import { newId } from '../core/store.js';
import { addDays, isISODate } from '../core/dates.js';
import { buildRentLedger, rentPeriodsFor, rentReceiptChanges } from '../core/rent.js';
import { paymentAllocations, paymentTransfer, allocationError } from '../core/payments.js';
import { openRentPeriod, rentRange } from './rentHistory.js';
import { buildStatement } from '../core/statement.js';
import { parseAmount } from '../ui/parse.js';
import { residentName } from './parts.js';

export const METHODS = ['zelle', 'venmo', 'wechat', 'alipay', 'cash', 'check', 'other'];
const lastMethod = (ctx, rid) => { const p = ctx.D.payments.find(x => x.residentId === rid && x.method); return p ? p.method : 'zelle'; };
const rentPeople = ctx => ctx.D.residents.filter(r => !r.isOwner).sort((a, b) => Number(!!a.moveOut && a.moveOut <= ctx.D.today) - Number(!!b.moveOut && b.moveOut <= ctx.D.today) || b.moveIn.localeCompare(a.moveIn));

/** 一笔收支保留一个总额和日期，按明确用途分配给多个租期及押金。 */
export function openPayment(ctx, { residentId, amount, rentId, payment, refund = false, purpose = 'rent', onSave } = {}) {
  payment = paymentTransfer(ctx.S, payment);
  const people = rentPeople(ctx);
  let rid = payment?.residentId || residentId || people[0]?.id, rows = [], L;
  const initialAmount = payment?.amount ?? amount ?? null;
  const target = part => part.purpose === 'deposit' ? 'deposit' : part.rentId ? 'rent:' + part.rentId : 'unassigned';
  let parts = payment ? paymentAllocations(payment).map(part => ({ target: target(part), amount: part.amount == null ? null : Math.abs(part.amount) }))
    : [{ target: purpose === 'deposit' ? 'deposit' : rentId ? 'rent:' + rentId : 'unassigned', amount: initialAmount }];
  let split = parts.length > 1;
  const f = { amount: initialAmount == null ? null : Math.abs(initialAmount), refund: initialAmount < 0 || refund,
    date: payment ? payment.date || '' : ctx.D.today, dateUnavailable: payment?.dateUnavailable === true,
    method: payment ? payment.method || 'other' : lastMethod(ctx, rid), note: payment?.note || '' };
  const err = h('p.err', { hidden: true }), prevEl = h('p.note'), quick = h('div.chips'), allocationBody = h('div.form');
  const amountLabel = h('span.field-label'), dateLabel = h('span.field-label');
  const dateInput = h('input', { type: 'date', value: f.dateUnavailable ? '' : f.date, disabled: f.dateUnavailable, oninput: e => { f.date = e.target.value; } });
  const dateHint = h('p.note', { hidden: !f.dateUnavailable }, t('rent.dateUnavailableHint'));
  const dateOption = h('label.check-line', null, h('input', { type: 'checkbox', checked: f.dateUnavailable, onchange: e => {
    f.dateUnavailable = e.target.checked; dateInput.disabled = f.dateUnavailable; dateInput.value = f.dateUnavailable ? '' : f.date; dateHint.hidden = !f.dateUnavailable;
  } }), h('span', null, t('rent.dateUnavailableOption')));
  const amtIn = h('input.big-amt', { inputmode: 'decimal', value: f.amount ?? '', oninput: e => {
    f.amount = parseAmount(e.target.value); if (!split) parts[0].amount = f.amount; preview();
  } });
  function preview() {
    amountLabel.textContent = t(f.refund ? 'housing.totalRefunded' : 'housing.totalReceived');
    dateLabel.textContent = t(f.refund ? 'rent.refundDate' : 'rent.receivedDate');
    quick.replaceChildren();
    if (split) {
      const cents = parts.reduce((n, part) => n + (Number.isFinite(part.amount) ? Math.round(part.amount * 100) : 0), 0);
      prevEl.textContent = t('housing.allocationTotals', { paid: cents / 100, total: f.amount == null ? '—' : money(f.amount), diff: f.amount == null ? '—' : money((Math.round(f.amount * 100) - cents) / 100) });
      return;
    }
    const chosen = rows.find(row => 'rent:' + row.id === parts[0].target);
    if (!chosen) { prevEl.textContent = t(parts[0].target === 'deposit' ? 'housing.depositSeparate' : 'rent.unassignedHint'); return; }
    const person = L.people[rid], item = person?.items.find(x => x.rentId === chosen.id);
    const received = (person?.payments || []).filter(x => x.rentId === chosen.id).reduce((n, x) => n + x.amount, 0);
    const expected = item ? item.unknown ? null : item.cents / 100 : chosen.amount;
    const incomplete = person?.incompleteReceipts.some(x => x.rentId === chosen.id) || (payment && f.amount == null);
    const left = expected != null && !incomplete ? Math.round((expected - received) * 100) / 100 : null;
    if (left > 0 && !f.refund) quick.append(h('button.chip', { type: 'button', onclick: () => {
      f.amount = left; parts[0].amount = left; amtIn.value = left.toFixed(2); preview();
    } }, t('rent.periodRemaining') + ' ' + money(left)));
    prevEl.textContent = left == null ? t('rent.receiptOnlyHint') : t('rent.periodBalance', { amount: left - (f.refund ? -1 : 1) * (f.amount || 0) });
  }
  function targetSelect(part) {
    const select = h('select', { onchange: e => {
      if (e.target.value === 'new') {
        select.value = part.target;
        openRentPeriod(ctx, rid, null, { onSave: rec => { if (rec) part.target = 'rent:' + rec.id; refreshPeriods(); } });
      } else { part.target = e.target.value; renderAllocations(); }
    } }, h('option', { value: 'unassigned', selected: part.target === 'unassigned' }, t('housing.rentLater')),
      ...rows.map(row => h('option', { value: 'rent:' + row.id, selected: part.target === 'rent:' + row.id }, rentRange(row) + (row.dueDate ? ' · ' + t('rent.dueShort') + ' ' + row.dueDate : ''))),
      h('option', { value: 'deposit', selected: part.target === 'deposit' }, t('housing.deposit')),
      h('option', { value: 'new' }, t('rent.newPeriod')));
    if (part.target.startsWith('rent:') && !rows.some(row => part.target === 'rent:' + row.id)) select.append(h('option', { value: part.target, selected: true }, t('housing.missingPeriod')));
    return select;
  }
  function renderAllocations() {
    const fields = parts.map((part, index) => {
      const chosen = rows.find(row => 'rent:' + row.id === part.target);
      const purposeField = h('label.field', null, h('span.field-label', null, t('housing.use')), targetSelect(part));
      const coverage = chosen ? h('p.note', null, t('rent.selectedPeriod', { due: chosen.dueDate || '—', start: chosen.periodStart || '—', end: chosen.periodEnd || '—' })) : null;
      if (!split) return h('div.form', null, purposeField, coverage,
        h('button.link-btn', { type: 'button', onclick: () => { split = true; sheet.el.classList.add('wide'); parts.push({ target: 'unassigned', amount: null }); renderAllocations(); } }, t('housing.split')));
      return h('fieldset.payment-allocation', null, h('div.field-row', null, purposeField,
        h('label.field', null, h('span.field-label', null, t('housing.partAmount')), h('input', { inputmode: 'decimal', value: part.amount ?? '', oninput: e => { part.amount = parseAmount(e.target.value); preview(); } }))), coverage,
        h('button.link-btn.danger', { type: 'button', disabled: parts.length < 2, onclick: () => { parts.splice(index, 1); renderAllocations(); } }, t('rent.removeChargeItem')));
    });
    allocationBody.replaceChildren(...fields);
    if (split) allocationBody.append(h('button.btn', { type: 'button', onclick: () => { parts.push({ target: 'unassigned', amount: null }); renderAllocations(); } }, '＋ ' + t('housing.addAllocation')));
    preview();
  }
  function refreshPeriods(auto = false) {
    const without = payment ? { ...ctx.S, data: { ...ctx.S.data, payments: { ...ctx.S.data.payments, [payment.id]: { ...payment, deleted: true } } } } : ctx.S;
    L = buildRentLedger(without, ctx.D.today); rows = rentPeriodsFor(ctx.S, rid, ctx.D.today);
    if (auto && parts[0].target === 'unassigned') {
      const next = rows.find(row => L.people[rid]?.debits.some(d => d.rentId === row.id && d.remaining > 0)) || rows.find(row => row.periodEnd >= ctx.D.today);
      if (next) parts[0].target = 'rent:' + next.id;
    }
    renderAllocations();
  }
  const methods = h('div.chips', { role: 'radiogroup', 'aria-label': t('pay.method') });
  const renderMethods = () => methods.replaceChildren(...METHODS.map(method => h('button.chip' + (f.method === method ? '.on' : ''), { type: 'button', role: 'radio', 'aria-checked': String(f.method === method), onclick: () => { f.method = method; renderMethods(); } }, t('method.' + method))));
  const personSelect = h('select', { onchange: e => {
    rid = e.target.value; parts = [{ target: purpose === 'deposit' ? 'deposit' : 'unassigned', amount: f.amount }]; split = false;
    f.method = lastMethod(ctx, rid); refreshPeriods(true); renderMethods();
  } }, people.map(person => h('option', { value: person.id, selected: person.id === rid }, person.name)));
  renderMethods(); refreshPeriods(!payment);
  const save = () => {
    const incomplete = payment && (payment.embeddedRentId || payment.confirmationOnly) && f.amount == null && !f.refund && !split && parts[0].target !== 'deposit';
    const fail = key => { err.textContent = t('housing.error.' + key); err.hidden = false; };
    if (!rid || !ctx.S.data.residents[rid] || ctx.S.data.residents[rid].deleted || ctx.S.data.residents[rid].isOwner) { fail('resident'); return; }
    if (!incomplete && (!Number.isFinite(f.amount) || f.amount < 0 || (f.amount === 0 && !payment) || f.amount > 1e7)) { fail('amount'); amtIn.focus(); return; }
    const receiptDate = f.dateUnavailable ? '' : f.date;
    if (receiptDate && !isISODate(receiptDate)) { fail('date'); return; }
    const currentRows = rentPeriodsFor(ctx.S, rid, ctx.D.today);
    if (parts.some(part => part.target.startsWith('rent:') && !currentRows.some(row => part.target === 'rent:' + row.id))) { fail('period'); return; }
    const current = payment && (payment.embeddedRentId ? ctx.S.data.rents[payment.embeddedRentId] : ctx.S.data.payments[payment.id]);
    if (current && current.updatedAt !== payment.updatedAt && !confirm(t(current.deleted ? 'form.deletedElsewhere' : 'form.changedElsewhere'))) return;
    const changes = payment ? rentReceiptChanges(ctx.S, payment) : { receipt: {}, rent: null };
    const sign = f.refund ? -1 : 1;
    const allocations = parts.map(part => ({ purpose: part.target === 'deposit' ? 'deposit' : 'rent', rentId: part.target.startsWith('rent:') ? part.target.slice(5) : null,
      amount: Number.isFinite(part.amount) ? Math.round(part.amount * 100) / 100 * sign : null }));
    const draft = { ...changes.receipt, deleted: undefined, deletedAt: undefined, id: payment?.id || 'pay_' + newId(), residentId: rid,
      purpose: incomplete ? 'rent' : 'housing', rentId: incomplete ? allocations[0].rentId : null, allocations: incomplete ? undefined : allocations,
      date: receiptDate, dateUnavailable: f.dateUnavailable || undefined, amount: incomplete ? null : Math.round(f.amount * 100) / 100 * sign,
      confirmationOnly: incomplete || undefined, method: f.method, note: f.note };
    const error = allocationError(draft);
    if (error) { fail(error); return; }
    let rec;
    ctx.batch(() => {
      if (changes.rent) ctx.put('rents', changes.rent);
      for (const part of allocations) if (part.rentId && !ctx.S.data.rents[part.rentId]) ctx.put('rents', currentRows.find(row => row.id === part.rentId));
      rec = ctx.put('payments', draft);
    });
    sheet.close(); onSave?.(rec);
    ctx.toast(t('res.saved'), { action: t('undo'), onAction: () => {
      if (payment) ctx.put('payments', rentReceiptChanges(ctx.S, payment).receipt); else ctx.remove('payments', rec.id);
      onSave?.();
    }, ms: 10000 });
  };
  const sheet = openSheet({ title: t(payment ? 'housing.editTransfer' : refund ? 'rent.recordRefund' : 'housing.record'), wide: split, closeLabel: t('rent.close'),
    body: h('form.form', { onsubmit: e => { e.preventDefault(); save(); } },
      residentId ? h('p', null, residentName(ctx, residentId)) : h('label.field', null, h('span.field-label', null, t('pay.who')), personSelect),
      h('label.field', null, h('span.field-label', null, t('rent.receiptType')), h('select', { onchange: e => { f.refund = e.target.value === 'refund'; preview(); } },
        ['receipt', 'refund'].map(kind => h('option', { value: kind, selected: f.refund === (kind === 'refund') }, t('rent.' + kind))))),
      h('label.field', null, amountLabel, amtIn, h('span.hint', null, t('housing.amountHint'))), quick,
      h('div.field-row', null, h('div.field', null, h('label.field', null, dateLabel, dateInput), dateOption, dateHint),
        h('div.field', null, h('span.field-label', null, t('pay.method')), methods)),
      h('section.form', null, h('h3', null, t('housing.allocationTitle')), allocationBody, prevEl),
      h('label.field', null, h('span.field-label', null, t('form.note')), h('input', { value: f.note, placeholder: t('pay.notePh'), oninput: e => { f.note = e.target.value; } })), err,
      h('button', { type: 'submit', hidden: true })),
    foot: [payment ? h('button.btn.danger', { type: 'button', onclick: () => deleteRentPayment(ctx, payment, () => { sheet.close(); onSave?.(); }) }, t('bill.delete')) : null,
      h('span.sp'), h('button.btn', { type: 'button', onclick: () => sheet.close() }, t('cancel')), h('button.btn.primary', { type: 'button', onclick: save }, t('save'))].filter(Boolean),
  });
}

export function deleteRentPayment(ctx, payment, onChange) {
  payment = paymentTransfer(ctx.S, payment);
  payment = ctx.S.data.payments[payment.id] || payment;
  const confirmation = openSheet({ title: t('bill.delete'), closeLabel: t('rent.close'), body: h('div', null,
    h('p', null, t('housing.totalAmount'), ' · ', money(payment.amount)),
    h('p', null, t(paymentAllocations(payment).length > 1 ? 'housing.deleteTransferConfirm' : 'pay.deleteConfirm'))),
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
  const f = { residentId: residentId || (people[0] && people[0].id), period: periodKey || L.current, lang: prefs.stLang || (getLang() === 'zh-Hans' ? 'zh' : getLang()), formula: prefs.stFormula !== false, usage: !!prefs.stUsage };
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
          ['zh', 'zh-Hant-TW', 'en'].map(l => h('option', { value: l, selected: f.lang === l }, LANG_LABELS[l === 'zh' ? 'zh-Hans' : l]))))),
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
