// 账单确认 / 编辑表单：PDF 识别出来的草稿、手动录入、修改已有账单都用这一张。
// 改任何字段，检查结果、对比和分摊预览都立刻重算；保存后自动分摊（分摊是现算的，见 core/analytics.js 的 billShares）。
import { h, openSheet, signButton } from '../ui/dom.js';
import { t, money, pct, num, unitLabel, period, date } from '../i18n.js';
import { billChecks } from '../core/checks.js';
import { billStats, compareBill, billShares, billDays } from '../core/analytics.js';
import { overlapDays, addDays, isISODate } from '../core/dates.js';
import { newId } from '../core/store.js';
import { KNOWN_PROVIDERS, ITEM_PRESETS, USAGE_PRESETS, USAGE_UNITS } from '../core/providers.js';
import { parseAmount } from '../ui/parse.js';
import { splitTable, checkList, explainLine } from './parts.js';
import { itemLabel } from './billDetail.js';
import { fieldGuide } from './notes.js';
import { readPdf, saveBillPdf } from '../core/documents.js';

export { parseAmount };
const clone = o => JSON.parse(JSON.stringify(o));
const amtStr = v => (typeof v === 'number' ? v.toFixed(2) : '');

/** 所有可选的公司：已有的 + 认识但还没建的 */
export function providerChoices(ctx) {
  const list = ctx.D.providerList.map(p => ({ id: p.id, name: p.name, category: p.category, active: p.active !== false }));
  for (const [k, v] of Object.entries(KNOWN_PROVIDERS)) if (!ctx.S.data.providers['p_' + k] || ctx.S.data.providers['p_' + k].deleted) list.push({ id: 'p_' + k, name: v.name, category: v.category, known: k, active: true });
  return list;
}
/** 公司记录不存在时（还没导入历史数据），用认识的默认值建一条 */
export function ensureProvider(ctx, id) {
  const p = ctx.S.data.providers[id];
  if (p && !p.deleted) return p;
  const k = id.replace(/^p_/, ''), d = KNOWN_PROVIDERS[k];
  if (!d) return null;
  return ctx.put('providers', { id, ...d, active: true });
}
const categoryOf = (ctx, providerId) => (providerChoices(ctx).find(p => p.id === providerId) || {}).category || 'internet';
/** 账单方的设置（还没建记录的用默认值） */
function providerInfo(ctx, id) {
  const p = ctx.S.data.providers[id];
  if (p && !p.deleted) return p;
  return KNOWN_PROVIDERS[String(id).replace(/^p_/, '')] || { category: 'internet' };
}
/** 识别结果 → 账单表单的初始内容 */
export function draftToBill(ctx, draft, src = {}) {
  return {
    providerId: draft.provider ? 'p_' + draft.provider : '',
    statementDate: draft.statementDate || '', periodStart: draft.periodStart || '', periodEnd: draft.periodEnd || '', dueDate: draft.dueDate || '',
    total: typeof draft.total === 'number' ? draft.total : null,
    items: (draft.items || []).map(i => ({ key: i.key, label: i.label, amount: i.amount })),
    usage: (draft.usage || []).map(u => ({ key: u.key, amount: u.amount, unit: u.unit })),
    accountLast4: draft.accountLast4 || null,
    itemPeriods: draft.servicePeriods || {},
    allocation: { mode: 'auto' }, note: '',
    source: { method: src.method || 'pdf', file: src.file || null, size: src.size || null, sha256: src.sha256 || null, parser: draft.provider || null, warnings: draft.warnings || [], at: Date.now() },
  };
}

/** 手动录入：按公司预填分项名称，服务期接在上一张后面，网费金额沿用上一张 */
export function manualDraft(ctx, providerId) {
  const cat = categoryOf(ctx, providerId);
  const prev = ctx.D.bills.find(b => b.providerId === providerId);
  const days = prev ? billDays(prev) : cat === 'water' ? 61 : 30;
  const start = prev && prev.periodEnd ? prev.periodEnd : '';
  return {
    providerId, statementDate: ctx.D.today, periodStart: start, periodEnd: start ? addDays(start, days) : '', dueDate: '',
    total: cat === 'internet' && prev ? prev.total : null,
    items: (ITEM_PRESETS[cat] || []).map(([key, label]) => ({ key, label, amount: cat === 'internet' && prev ? prev.total : null })),
    usage: (USAGE_PRESETS[cat] || []).map(([key, unit]) => ({ key, unit, amount: null })),
    accountLast4: prev ? prev.accountLast4 || null : null,
    allocation: { mode: 'auto' }, note: '',
    source: { method: 'manual', at: Date.now() },
  };
}

/**
 * 打开表单
 * @param {{ draft?, existing?, queue?: { i, n }, onDone?: (saved|null) => void }} o
 */
export function openBillForm(ctx, o) {
  const editingId = o.existing ? o.existing.id : null;
  const w = clone(o.existing || o.draft);
  w.items = w.items || []; w.usage = w.usage || []; w.allocation = w.allocation || { mode: 'auto' };
  const fromPdf = !o.existing && w.source && (w.source.method === 'pdf' || w.source.method === 'paste');
  const origin = {};       // 每个字段的来历：pdf / missing / edited
  if (fromPdf) for (const f of ['providerId', 'statementDate', 'periodStart', 'periodEnd', 'dueDate', 'total']) origin[f] = w[f] != null && w[f] !== '' ? 'pdf' : 'missing';
  let dirty = false, done = false, skipped = false, saved = null, saving = false;
  if (!o.existing) w.collectPeriod = null;

  const checksEl = h('div.form-checks'), cmpEl = h('div.form-compare'), splitEl = h('div.form-split');
  const itemsEl = h('div.rows'), usageEl = h('div.rows'), manualEl = h('div.manual-shares');
  const itemsSumEl = h('div.items-sum');
  const tags = {};

  const asBill = () => ({
    ...w, id: editingId || '__new',
    endInclusive: providerInfo(ctx, w.providerId).periodConvention === 'inclusive' ? true : undefined,
    total: parseAmount(w.total),
    items: w.items.filter(i => i.amount !== null && i.amount !== '' && parseAmount(i.amount) != null).map(i => ({ ...i, amount: parseAmount(i.amount) })),
    usage: w.usage.filter(u => parseAmount(u.amount) != null).map(u => ({ ...u, amount: Number(String(u.amount).replace(/,/g, '')) })),
    allocation: w.allocation.mode === 'manual' ? { mode: 'manual', shares: Object.fromEntries(Object.entries(w.allocation.shares || {}).map(([k, v]) => [k, parseAmount(v) || 0]).filter(([, v]) => v)) } : clone(w.allocation),
  });

  // ---------- 字段 ----------
  const label = (f, text) => {
    const tag = h('span.field-tag');
    tags[f] = tag;
    return h('span.field-label', null, text, tag);
  };
  const markTag = f => {
    const el = tags[f]; if (!el) return;
    const o2 = origin[f];
    el.className = 'field-tag' + (o2 ? ' ' + o2 : '');
    el.textContent = o2 === 'pdf' ? t('form.fromPdf') : o2 === 'missing' ? t('form.notRead') : o2 === 'edited' ? '✎ ' + t('form.edited') : '';
  };
  const touch = (f) => { dirty = true; if (fromPdf && origin[f] !== 'edited') { origin[f] = 'edited'; markTag(f); } update(); };
  const input = (f, attrs = {}) => {
    const el = h('input', { ...attrs, value: f === 'total' ? (typeof w.total === 'number' ? w.total.toFixed(2) : (w.total ?? '')) : (w[f] || ''),
      class: [attrs.class, origin[f] === 'missing' ? 'missing' : null].filter(Boolean).join(' ') || null,
      oninput: e => {
        w[f] = e.target.value; e.target.classList.remove('missing');
        touch(f);
      } });
    return el;
  };
  const daysEl = h('span.muted.small');

  const choices = providerChoices(ctx);
  const providerSel = h('select', { onchange: e => {
    w.providerId = e.target.value;
    const cat = categoryOf(ctx, w.providerId);
    if (!w.items.some(i => parseAmount(i.amount) != null)) { w.items = (ITEM_PRESETS[cat] || []).map(([key, lab]) => ({ key, label: lab, amount: null })); renderItems(); }
    if (!w.usage.some(u => parseAmount(u.amount) != null)) { w.usage = (USAGE_PRESETS[cat] || []).map(([key, unit]) => ({ key, unit, amount: null })); renderUsage(); }
    touch('providerId');
  } },
  h('option', { value: '', selected: !w.providerId }, t('form.chooseProvider')),
  choices.filter(p => p.active || p.id === w.providerId).map(p => h('option', { value: p.id, selected: p.id === w.providerId }, p.name)));

  function renderItems() {
    itemsEl.replaceChildren(...w.items.map((it, i) => h('div.row-line', null,
      h('input.grow', { value: it.key && t('item.' + it.key) !== 'item.' + it.key && !it.label ? t('item.' + it.key) : it.label || '', 'aria-label': t('form.itemName'),
        oninput: e => { it.label = e.target.value; dirty = true; } }),
      ...(() => { const inp = h('input.amt', { inputmode: 'decimal', value: amtStr(parseAmount(it.amount)) || (it.amount ?? ''), placeholder: '0.00', 'aria-label': t('form.amount'),
        oninput: e => { it.amount = e.target.value; dirty = true; update(); } }); return [inp, signButton(inp)]; })(),
      h('button.icon-btn', { type: 'button', 'aria-label': t('form.remove'), onclick: () => { w.items.splice(i, 1); renderItems(); dirty = true; update(); } }, '✕'))),
    h('div.row-actions', null, h('button.link-btn', { type: 'button', onclick: () => { w.items.push({ key: 'other', label: '', amount: null }); renderItems(); } }, '＋ ' + t('form.addItem'))));
  }
  function renderUsage() {
    usageEl.replaceChildren(...w.usage.map((u, i) => h('div.row-line', null,
      h('select', { 'aria-label': t('form.usageKind'), onchange: e => { u.key = e.target.value; u.unit = USAGE_UNITS[u.key] || u.unit; renderUsage(); update(); } },
        Object.keys(USAGE_UNITS).map(k => h('option', { value: k, selected: k === u.key }, t('usage.' + k)))),
      h('input.amt', { inputmode: 'decimal', value: u.amount ?? '', 'aria-label': t('form.amount'), oninput: e => { u.amount = e.target.value; dirty = true; update(); } }),
      h('span.unit', null, unitLabel(u.unit)),
      h('button.icon-btn', { type: 'button', 'aria-label': t('form.remove'), onclick: () => { w.usage.splice(i, 1); renderUsage(); dirty = true; update(); } }, '✕'))),
    h('div.row-actions', null, h('button.link-btn', { type: 'button', onclick: () => { w.usage.push({ key: 'electricity', unit: 'kWh', amount: null }); renderUsage(); } }, '＋ ' + t('form.addUsage'))));
  }
  let manualIds = '';
  function renderManual() {
    if (w.allocation.mode !== 'manual') { manualEl.replaceChildren(); manualIds = ''; return; }
    const b = asBill();
    const p = choices.find(x => x.id === b.providerId) || { category: 'internet' };
    const auto = b.periodStart && b.periodEnd && typeof b.total === 'number' ? billShares({ ...b, allocation: { mode: 'auto' } }, p, ctx.D.residents).shares : {};
    if (!w.allocation.shares) w.allocation.shares = { ...auto };
    const people = ctx.D.residents.filter(r => w.allocation.shares[r.id] != null || auto[r.id] != null || (b.periodStart && b.periodEnd && overlapDays(r.moveIn, r.moveOut || '9999-12-31', b.periodStart, b.periodEnd) > 0));
    manualIds = people.map(r => r.id).join(',');
    manualEl.replaceChildren(...people.map(r => h('label.row-line', null, h('span.grow', null, r.name),
      h('input.amt', { inputmode: 'decimal', value: amtStr(parseAmount(w.allocation.shares[r.id])) || '', placeholder: '0.00',
        oninput: e => { w.allocation.shares[r.id] = e.target.value; dirty = true; update(); } }))));
  }

  // ---------- 实时检查、对比、分摊预览 ----------
  function update() {
    const b = asBill();
    // 手动分摊：服务期改了以后住着的人变了，名单要跟着变（已经填的金额保留）
    if (w.allocation.mode === 'manual' && b.periodStart && b.periodEnd && isISODate(b.periodStart) && isISODate(b.periodEnd)) {
      const ids = ctx.D.residents.filter(r => (w.allocation.shares || {})[r.id] != null || overlapDays(r.moveIn, r.moveOut || '9999-12-31', b.periodStart, b.periodEnd) > 0).map(r => r.id).join(',');
      if (ids !== manualIds) { for (const r of ctx.D.residents) if (ids.split(',').includes(r.id) && (w.allocation.shares || {})[r.id] == null) { w.allocation.shares = w.allocation.shares || {}; w.allocation.shares[r.id] = ''; } renderManual(); }
    }
    const st = b.periodStart && b.periodEnd && isISODate(b.periodStart) && isISODate(b.periodEnd) ? billDays(b) : 0;
    daysEl.textContent = st > 0 ? t('bill.days', { n: st }) : '';
    const sum = b.items.reduce((a, i) => a + i.amount, 0);
    const diff = Math.round(((b.total || 0) - sum) * 100) / 100;
    itemsSumEl.replaceChildren(b.items.length ? h('span', { class: Math.abs(diff) > 0.005 ? 'warn-text' : 'muted' }, t('form.itemsSum', { sum: Math.round(sum * 100) / 100 }), Math.abs(diff) > 0.005 ? [' · ', t('form.itemsDiff', { diff })] : ' ✓') : '',
      b.items.length && Math.abs(diff) > 0.005 && typeof b.total === 'number' ? h('button.link-btn', { type: 'button', onclick: () => { w.items.push({ key: 'other', label: t('item.other'), amount: diff }); renderItems(); update(); } }, t('form.addDiff')) : null);
    const checks = billChecks(b, ctx.D.bills, { editingId, anomalyPct: ctx.S.settings.anomalyPct, anomalyMin: ctx.S.settings.anomalyMin, lockedTotal: o.existing ? o.existing.total : null, providers: { ...ctx.D.providers, [b.providerId]: providerInfo(ctx, b.providerId) } });
    checksEl.replaceChildren(checkList(checks));
    const ok = !checks.some(c => c.level === 'error');
    saveBtn.textContent = ok ? (o.existing ? t('form.save') : t('form.saveSplit')) : t('form.fixFirst', { n: checks.filter(c => c.level === 'error').length });
    saveBtn.classList.toggle('disabled', !ok);
    if (ok) {
      const cat = providerInfo(ctx, b.providerId).category;
      const same = ctx.D.bills.filter(x => (ctx.D.providers[x.providerId] || {}).category === cat && x.id !== editingId);
      const c = compareBill(b, same), s = billStats(b);
      cmpEl.replaceChildren(h('div.cmp-line', null,
        h('b', null, t('bill.perDay', { amount: s.perDay })),
        c.prev ? h('span', null, t('form.vsPrev', { pct: pct(c.prev.perDayChange) })) : null,
        c.lastYear ? h('span', null, t('form.vsLastYear', { pct: pct(c.lastYear.perDayChange) })) : null),
      Object.entries(s.usage).filter(([k]) => k !== 'data').map(([k, u]) => h('div.cmp-line.small.muted', null, t('usage.' + k) + ' ' + t('usage.perDayVal', { v: num(u.perDay, u.perDay < 10 ? 2 : 1), unit: unitLabel(u.unit) }),
        c.lastYear && c.lastYear.usageChange[k] != null ? ' · ' + t('form.vsLastYear', { pct: pct(c.lastYear.usageChange[k]) }) : '')),
      explainLine(b, { ...ctx, D: { ...ctx.D, sameCategory: () => same } }, c));
      try { splitEl.replaceChildren(splitTable({ ...b, id: editingId || '__new' }, ctx)); }
      catch (e) { splitEl.replaceChildren(h('p.muted', null, t('form.splitLater'))); }
    } else {
      cmpEl.replaceChildren(h('p.muted.small', null, t('form.fillFirst')));
      splitEl.replaceChildren(h('p.muted.small', null, t('form.fillFirst')));
    }
  }

  const allocModes = ['auto', 'manual', ...(o.existing && o.existing.allocation && o.existing.allocation.mode === 'locked' ? ['locked'] : [])];
  const allocEl = h('div.seg', { role: 'radiogroup', 'aria-label': t('form.allocation') }, allocModes.map(m => h('label.seg-opt', null,
    h('input', { type: 'radio', name: 'alloc', value: m, checked: w.allocation.mode === m, onchange: () => {
      w.allocation = m === 'locked' ? clone(o.existing.allocation) : m === 'manual' ? { mode: 'manual', shares: null } : { mode: 'auto' };
      dirty = true; renderManual(); update();
    } }), h('span', null, t('alloc.' + m)))));

  const paidBox = h('input', { type: 'checkbox', checked: !!w.paidAt, onchange: e => { w.paidAt = e.target.checked ? ctx.D.today : null; dirty = true; } });
  const saveBtn = h('button.btn.primary', { type: 'button', onclick: save });
  const warnings = (w.source && w.source.warnings) || [];

  const body = h('div.bill-form', null,
    o.queue && o.queue.n > 1 ? h('div.queue', null, t('form.queue', { i: o.queue.i + 1, n: o.queue.n })) : null,
    w.source && w.source.file ? h('div.form-file.muted.small', null, '📄 ', w.source.file) : null,
    fromPdf ? h('p.note', null, t('form.pdfHint')) : null,
    warnings.length ? h('div.parser-warnings', null, h('b', null, t('form.parserNotes')), h('ul', null, warnings.map(x => h('li', null, x)))) : null,
    checksEl,
    h('fieldset', null, h('legend', null, t('form.basics')),
      h('label.field', null, label('providerId', t('field.providerId')), providerSel),
      h('div.field-row', null,
        h('label.field', null, label('statementDate', t('field.statementDate')), input('statementDate', { type: 'date' })),
        h('label.field', null, label('dueDate', t('field.dueDate')), input('dueDate', { type: 'date' }))),
      h('div.field-row', null,
        h('label.field', null, label('periodStart', t('field.periodStart')), input('periodStart', { type: 'date' })),
        h('label.field', null, label('periodEnd', t('field.periodEnd')), input('periodEnd', { type: 'date' }))),
      daysEl),
    h('fieldset', null, h('legend', null, t('form.amounts')),
      h('label.field', null, label('total', t('field.total')), (() => { const inp = input('total', { inputmode: 'decimal', class: 'big-amt', placeholder: '0.00' }); return h('div.amt-line', null, inp, signButton(inp)); })(), h('span.hint', null, t('form.totalHint'))),
      h('div.field', null, h('span.field-label', null, t('bill.items')), itemsEl, itemsSumEl), fieldGuide(w.items.map(i => i.key))),
    h('fieldset', null, h('legend', null, t('bill.usage')), usageEl),
    h('details', null, h('summary', null, t('form.compare')), cmpEl),
    h('details', null, h('summary', null, t('rent.legacyRules')), allocEl, manualEl, splitEl),
    h('fieldset', null, h('legend', null, t('form.more')),
      h('label.check-line', null, paidBox, h('span', null, t('form.paid'))),
      h('label.field', null, h('span.field-label', null, t('form.note')), h('textarea', { rows: 2, value: w.note || '', oninput: e => { w.note = e.target.value; dirty = true; } }))));

  const sheet = openSheet({
    title: o.existing ? t('form.editTitle') : t('form.newTitle'), wide: true, body,
    foot: [o.queue && o.queue.n > 1 ? h('button.btn', { type: 'button', onclick: () => { done = true; skipped = true; sheet.close(); } }, t('form.skip')) : null,
      h('span.sp'), h('button.btn', { type: 'button', onclick: () => sheet.tryClose() }, t('cancel')), saveBtn].filter(Boolean),
    beforeClose: () => done || !dirty || confirm(t('form.discard')),
    onClose: () => { if (o.onDone) o.onDone({ saved, skipped }); },
  });
  for (const f of Object.keys(tags)) markTag(f);
  renderItems(); renderUsage(); renderManual(); update();

  async function save() {
    if (saving) return;
    const b = asBill();
    const checks = billChecks(b, ctx.D.bills, { editingId, anomalyPct: ctx.S.settings.anomalyPct, lockedTotal: o.existing ? o.existing.total : null, providers: { ...ctx.D.providers, [b.providerId]: providerInfo(ctx, b.providerId) } });
    if (checks.some(c => c.level === 'error')) { checksEl.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    const dup = checks.find(c => c.code === 'dupFile' || c.code === 'dupDate' || c.code === 'dupPeriod');
    if (dup && !confirm(t('form.dupConfirm', { date: dup.vars.date || dup.vars.start }))) return;
    if (o.existing) {
      const now = ctx.S.data.bills[editingId];
      if (now && now.updatedAt !== o.existing.updatedAt && !confirm(now.deleted ? t('form.deletedElsewhere') : t('form.changedElsewhere'))) return;
    }
    const provider = ensureProvider(ctx, b.providerId);
    if (!provider) return;
    let id = editingId;
    if (!id) {
      id = `b_${b.providerId.replace(/^p_/, '')}_${b.statementDate}`;
      const clash = ctx.S.data.bills[id];
      if (clash && !clash.deleted) id += '_' + newId().slice(-6);
    }
    const rec = { ...b, id };
    delete rec.updatedAt;
    if (rec.source) { rec.source = { ...rec.source }; delete rec.source.warnings; }   // 解析提醒里可能有账单原文（姓名、地址），不保存、不同步
    if (!rec.endInclusive) delete rec.endInclusive;
    rec.collectPeriod = w.collectPeriod || null;
    rec.items = rec.items.map(i => ({ key: i.key || 'other', label: i.label || itemLabel(i), amount: i.amount }));
    if (!rec.dueDate) rec.dueDate = null;
    const prev = ctx.S.data.bills[id];
    let pdfFailed = false;
    if (o.pdfFile) {
      saving = true; saveBtn.disabled = true;
      try { await saveBillPdf(id, await readPdf(o.pdfFile)); } catch (e) { pdfFailed = true; }
    }
    saved = ctx.put('bills', rec);
    done = true;
    sheet.close();
    const n = Object.keys(billShares(saved, provider, ctx.D.residents).shares).length;
    ctx.toast(pdfFailed ? t('pdf.billSavedWithout') : o.existing ? t('form.savedEdit') : t('form.saved', { provider: provider.name, period: period(saved.periodStart, saved.periodEnd), n }), {
      action: t('undo'), ms: 10000,
      onAction: () => { if (prev && !prev.deleted) ctx.put('bills', prev); else ctx.remove('bills', id); },
    });
    if (!o.queue || o.queue.i + 1 >= o.queue.n) ctx.nav('bill/' + encodeURIComponent(id));
  }
  return sheet;
}
