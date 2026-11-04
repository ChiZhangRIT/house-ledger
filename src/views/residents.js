// 住户：时间轴 + 列表；编辑入住/搬出、权重、参与方式（分摊 / 不参与 / 我承担）、月租。
// 保存前如果会改变金额（未锁定账单的分摊、房租），先给出影响预览。
import { h, openSheet } from '../ui/dom.js';
import { t, money, date } from '../i18n.js';
import { personColor } from '../ui/colors.js';
import { dayNumber, addDays, isISODate, overlapDays } from '../core/dates.js';
import { newId } from '../core/store.js';
import { participation, weightOn } from '../core/split.js';
import { rentOn } from '../core/ledger.js';
import { buildRentLedger } from '../core/rent.js';
import { SPLIT_CATEGORIES } from '../core/providers.js';
import { avatar, emptyState } from './parts.js';
import { parseAmount } from '../ui/parse.js';

export function render(root, ctx) {
  const D = ctx.D;
  root.append(h('div.filters', null, h('span.sp'), h('button.btn.primary', { type: 'button', onclick: () => openResident(ctx, null) }, '＋ ' + t('res.add'))));
  if (!D.residents.length) { root.append(emptyState(t('res.none'))); return; }
  root.append(timeline(D));
  const living = D.residents.filter(r => !r.moveOut || r.moveOut > D.today), gone = D.residents.filter(r => r.moveOut && r.moveOut <= D.today);
  for (const [title, list] of [[t('res.living'), living], [t('res.movedOut'), gone]]) {
    if (!list.length) continue;
    root.append(h('section.card', null, h('h2.section-h', null, title, h('span.muted', null, ' ' + list.length)),
      h('div.people', null, list.map(r => {
        const rent = rentOn(r, D.today);
        return h('button.person', { type: 'button', onclick: () => openResident(ctx, r) }, avatar(r),
          h('span.person-name', null, r.name, r.isOwner ? h('span.badge', null, t('res.owner')) : null,
            h('small.muted.block', null, date(r.moveIn), ' – ', r.moveOut ? date(r.moveOut) : t('res.now'), ' · ×', String(weightOn(r, r.moveOut && r.moveOut <= D.today ? addDays(r.moveOut, -1) : D.today)),
              SPLIT_CATEGORIES.some(c => participation(r, c) !== 'share') ? ' · ' + SPLIT_CATEGORIES.filter(c => participation(r, c) !== 'share').map(c => t('splitcat.' + c) + t('p.colon') + t('part.' + participation(r, c))).join(t('p.sep')) : '')),
          h('span.person-amt', null, rent != null && !r.isOwner ? t('res.rentNow', { amount: rent }) : ''));
      }))));
  }
  root.append(h('p.note', null, t('res.note')));
}

/** 甘特图：每人一条，权重变化处标出，今天一条线 */
function timeline(D) {
  const res = D.residents.filter(r => r.moveIn);
  const start = dayNumber(res.map(r => r.moveIn).sort()[0]), end = dayNumber(D.today) + 30;
  const W = 1000, row = 26, top = 18, H = top + res.length * row + 6;
  const X = d => 120 + (W - 130) * (d - start) / (end - start);
  const NS = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs, text) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); if (text != null) e.textContent = text; return e; };
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'timeline', role: 'img', 'aria-label': t('res.timeline') });
  const y0 = Number(D.today.slice(0, 4)), y1 = Number(res.map(r => r.moveIn).sort()[0].slice(0, 4));
  for (let y = y1 + 1; y <= y0; y++) { const x = X(dayNumber(`${y}-01-01`)); svg.append(el('line', { x1: x, x2: x, y1: 12, y2: H, class: 'viz-grid' }), el('text', { x: x + 3, y: 11, class: 'viz-tick' }, String(y))); }
  res.forEach((r, i) => {
    const y = top + i * row;
    const a = dayNumber(r.moveIn), b = r.moveOut ? dayNumber(r.moveOut) : end;
    svg.append(el('text', { x: 0, y: y + 15, class: 'tl-name' }, r.name.length > 14 ? r.name.slice(0, 13) + '…' : r.name));
    const bar = el('rect', { x: X(a), y: y + 4, width: Math.max(2, X(b) - X(a)), height: 14, rx: 4, style: `fill:${personColor(r.id)}`, opacity: SPLIT_CATEGORIES.every(c => participation(r, c) === 'excluded') ? 0.35 : 0.85 });
    const title = el('title', {}, `${r.name}: ${r.moveIn} – ${r.moveOut || t('res.now')}`);
    bar.append(title); svg.append(bar);
    for (const w of r.weights || []) {
      const d = dayNumber(w.from);
      if (d <= a || d >= b) { if (d <= a && Number(w.weight) !== 1) svg.append(el('text', { x: X(a) + 4, y: y + 15, class: 'tl-mark' }, '×' + w.weight)); continue; }
      svg.append(el('line', { x1: X(d), x2: X(d), y1: y + 2, y2: y + 20, class: 'tl-cut' }), el('text', { x: X(d) + 3, y: y + 15, class: 'tl-mark' }, '×' + w.weight));
    }
  });
  const tx = X(dayNumber(D.today));
  svg.append(el('line', { x1: tx, x2: tx, y1: 12, y2: H, class: 'tl-today' }));
  return h('section.card.timeline-card', null, h('h2.section-h', null, t('res.timeline')), h('div.timeline-wrap', null, svg));
}

/** 编辑 / 新建住户 */
export function openResident(ctx, r) {
  const isNew = !r;
  const w = r ? JSON.parse(JSON.stringify(r)) : { id: 'r_' + newId(), name: '', moveIn: ctx.D.today, moveOut: null, weights: [], utilities: { energy: 'share', water: 'share', internet: 'share' }, rent: [], isOwner: !ctx.D.residents.some(x => x.isOwner) };
  w.weights = w.weights || []; w.rent = w.rent || []; w.utilities = w.utilities || {};
  let dirty = false;
  const err = h('p.err', { hidden: true });
  const fail = msg => { err.textContent = msg; err.hidden = false; err.scrollIntoView({ block: 'nearest' }); };
  const listEl = (arr, field, unitLabel, parse) => {
    const box = h('div.rows');
    const draw = () => box.replaceChildren(...arr.map((x, i) => h('div.row-line', null,
      h('span.small.muted', null, t('res.from')),
      h('input', { type: 'date', value: x.from || '', oninput: e => { x.from = e.target.value; dirty = true; } }),
      h('input.amt', { inputmode: 'decimal', value: x[field] ?? '', placeholder: unitLabel, oninput: e => { x[field] = parse(e.target.value); dirty = true; } }),
      h('button.icon-btn', { type: 'button', 'aria-label': t('form.remove'), onclick: () => { arr.splice(i, 1); dirty = true; draw(); } }, '✕'))),
    h('div.row-actions', null, h('button.link-btn', { type: 'button', onclick: () => { arr.push({ from: ctx.D.today, [field]: null }); draw(); } }, '＋ ' + t('res.addRow'))));
    draw();
    return box;
  };
  const partSel = c => h('label.field', null, h('span.field-label', null, t('splitcat.' + c)),
    h('select', { onchange: e => { w.utilities[c] = e.target.value; dirty = true; } }, ['share', 'excluded', 'owner'].map(v => h('option', { value: v, selected: participation(w, c) === v }, t('part.' + v)))));
  const save = () => {
    err.hidden = true;
    if (!w.name.trim()) return fail(t('res.needName'));
    if (!isISODate(w.moveIn)) return fail(t('res.needMoveIn'));
    if (w.moveOut && (!isISODate(w.moveOut) || w.moveOut <= w.moveIn)) return fail(t('res.badMoveOut'));
    // 整理出要保存的副本，不改 w 本身（取消影响预览后还能接着改表格里的行）
    const rec = { ...w, name: w.name.trim(),
      weights: w.weights.filter(x => isISODate(x.from) && x.weight != null && x.weight !== '' && Number.isFinite(Number(x.weight)) && Number(x.weight) >= 0).map(x => ({ from: x.from, weight: Number(x.weight) })).sort((a, b) => (a.from < b.from ? -1 : 1)),
      rent: w.rent.filter(x => isISODate(x.from) && typeof x.amount === 'number').map(x => ({ from: x.from, amount: x.amount })).sort((a, b) => (a.from < b.from ? -1 : 1)) };
    delete rec.updatedAt;
    const now = ctx.S.data.residents[w.id];
    if (!isNew && now && now.updatedAt !== r.updatedAt && !confirm(now.deleted ? t('form.deletedElsewhere') : t('form.changedElsewhere'))) return;
    const changes = impact(ctx, rec);
    const commit = () => {
      ctx.batch(() => {
        if (rec.isOwner) for (const o of ctx.D.residents) if (o.isOwner && o.id !== rec.id) ctx.put('residents', { ...o, isOwner: false });
        ctx.put('residents', rec);
      });
      sheet.close();
      ctx.toast(isNew ? t('res.added') : t('res.saved'));
    };
    if (!changes.length) return commit();
    const pv = openSheet({
      title: t('res.impactH'),
      body: h('div', null, h('p', null, t('res.impactP')),
        h('table.data-table', null, h('tbody', null, changes.map(c => h('tr', null, h('th', null, c.name), h('td.num', null, money(c.before), ' → ', h('b', null, money(c.after))), h('td.num', null, money(c.after - c.before, { sign: true })))))),
        h('p.note', null, t('res.impactNote'))),
      foot: [h('span.sp'), h('button.btn', { type: 'button', onclick: () => pv.close() }, t('cancel')), h('button.btn.primary', { type: 'button', onclick: () => { pv.close(); commit(); } }, t('res.impactGo'))],
    });
  };
  const del = () => {
    // 有分摊（包括自动分摊的账单）、收款、调整、房租记录的住户不能删：删了会把钱重新分给别人
    const lived = ctx.D.bills.some(b => b.periodStart && b.periodEnd && overlapDays(w.moveIn, w.moveOut || '9999-12-31', b.periodStart, b.periodEnd) > 0);
    const used = lived || ctx.D.bills.some(b => b.allocation && b.allocation.shares && b.allocation.shares[w.id]) || ctx.D.payments.some(p => p.residentId === w.id)
      || Object.values(ctx.S.data.adjustments || {}).some(a => !a.deleted && a.residentId === w.id) || Object.values(ctx.S.data.rents || {}).some(a => !a.deleted && a.residentId === w.id);
    if (used) { fail(t('res.cantDelete')); return; }
    if (!confirm(t('res.deleteConfirm', { name: w.name }))) return;
    ctx.remove('residents', w.id);
    sheet.close();
  };
  const rentBox = h('fieldset', { hidden: !!w.isOwner }, h('legend', null, t('res.rent')), h('p.note', null, t('res.rentHint')), listEl(w.rent, 'amount', '$', parseAmount));
  const sheet = openSheet({
    title: isNew ? t('res.add') : t('res.edit'), wide: true,
    body: h('div.form', null,
      h('div.field-row', null,
        h('label.field', null, h('span.field-label', null, t('res.name')), h('input', { value: w.name, oninput: e => { w.name = e.target.value; dirty = true; } })),
        h('label.field', null, h('span.field-label', null, t('res.shortName')), h('input', { value: w.shortName || '', placeholder: t('res.shortNamePh'), oninput: e => { w.shortName = e.target.value || undefined; dirty = true; } }))),
      h('div.field-row', null,
        h('label.field', null, h('span.field-label', null, t('res.moveIn')), h('input', { type: 'date', value: w.moveIn || '', oninput: e => { w.moveIn = e.target.value; dirty = true; } })),
        h('label.field', null, h('span.field-label', null, t('res.moveOut')), h('input', { type: 'date', value: w.moveOut || '', oninput: e => { w.moveOut = e.target.value || null; dirty = true; } }), h('span.hint', null, t('res.moveOutHint')))),
      h('label.check-line', null, h('input', { type: 'checkbox', checked: !!w.isOwner, onchange: e => { w.isOwner = e.target.checked; rentBox.hidden = w.isOwner; dirty = true; } }), h('span', null, t('res.isOwner'))),
      rentBox,
      h('details', null, h('summary', null, t('rent.legacyRules')),
        h('fieldset', null, h('legend', null, t('res.weights')), h('p.note', null, t('res.weightsHint')), listEl(w.weights, 'weight', '×1', v => (v === '' ? null : Number(v)))),
        h('fieldset', null, h('legend', null, t('res.participation')), h('div.field-row', null, SPLIT_CATEGORIES.map(partSel)), h('p.note', null, t('res.partHint')))),
      h('label.field', null, h('span.field-label', null, t('form.note')), h('textarea', { rows: 2, value: w.note || '', oninput: e => { w.note = e.target.value; dirty = true; } })),
      err),
    foot: [!isNew ? h('button.btn.danger', { type: 'button', onclick: del }, t('bill.delete')) : null, h('span.sp'),
      h('button.btn', { type: 'button', onclick: () => sheet.tryClose() }, t('cancel')), h('button.btn.primary', { type: 'button', onclick: save }, t('save'))].filter(Boolean),
    beforeClose: () => !dirty || confirm(t('form.discard')),
  });
  const origClose = sheet.close;
  sheet.close = () => { dirty = false; origClose(); };
}

/** 改住户会让谁的应收变多少（未锁定账单的分摊 + 房租），按人汇总 */
function impact(ctx, rec) {
  const S = ctx.S;
  const before = buildRentLedger(S, ctx.D.today);
  const residents = { ...S.data.residents, [rec.id]: { ...rec, updatedAt: Date.now() } };
  if (rec.isOwner) for (const [id, r] of Object.entries(residents)) if (id !== rec.id && r.isOwner) residents[id] = { ...r, isOwner: false };   // 和 commit() 一样换主租客
  const after = buildRentLedger({ ...S, data: { ...S.data, residents } }, ctx.D.today);
  const ids = new Set([...Object.keys(before.people), ...Object.keys(after.people)]);
  const out = [];
  for (const id of ids) {
    const a = before.people[id], b = after.people[id];
    const x = a ? a.items.reduce((s, i) => s + (i.cents || 0), 0) / 100 : 0, y = b ? b.items.reduce((s, i) => s + (i.cents || 0), 0) / 100 : 0;
    if (Math.abs(x - y) > 0.005) out.push({ name: (S.data.residents[id] || rec).name || rec.name, before: x, after: y });
  }
  return out;
}
