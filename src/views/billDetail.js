// 账单详情：全部字段、分项、用量和单价、对比、分摊、来源；可以编辑、标记已缴、锁定/解锁、删除、加到日历
import { h, openSheet, download } from '../ui/dom.js';
import { t, money, date, period, num, rate, unitLabel, relDays } from '../i18n.js';
import { providerColor, ITEM_COLOR } from '../ui/colors.js';
import { billStats, billShares } from '../core/analytics.js';
import { dayNumber } from '../core/dates.js';
import { billBadges, splitTable, compareTable, dot, providerOf, residentName, emptyState } from './parts.js';
import { openBillForm } from './billForm.js';
import { billNotes, fieldGuide } from './notes.js';
import { providerHistory } from './providerHistory.js';
import { billDocument } from './documents.js';
import { openResident } from './residents.js';

export function render(root, ctx, [id]) {
  const b = Object.prototype.hasOwnProperty.call(ctx.S.data.bills, id) ? ctx.S.data.bills[id] : null;
  if (!b || b.deleted) { root.append(emptyState(t('bill.notFound'), h('a.btn', { href: '#/bills' }, t('nav.bills')))); return; }
  const p = providerOf(ctx, b), st = billStats(b), D = ctx.D;
  const locked = b.allocation && b.allocation.mode === 'locked';

  root.append(h('a.back', { href: '#/bills' }, '‹ ' + t('nav.bills')));
  root.append(h('section.card.bill-head', null,
    h('div.bill-head-top', null,
      h('div', null, h('div.bill-provider', null, dot(providerColor(p)), h('b', null, p.name), b.accountLast4 ? h('span.muted', null, ' ··' + b.accountLast4) : null),
        h('div.bill-period', null, p.category === 'water' ? t('u.meterPeriod') + ' ' : '', period(b.periodStart, b.periodEnd, 'iso'), st.days ? h('span.muted', null, ' · ' + t('bill.days', { n: st.days })) : null),
        h('div.badges', null, billBadges(b, ctx))),
      h('div.bill-total', null, h('span.num', null, money(b.total)), st.perDay != null ? h('div.muted.small', null, t('bill.perDay', { amount: st.perDay })) : null)),
    h('dl.facts', null,
      fact(t('field.statementDate'), date(b.statementDate, 'iso')),
      fact(t('field.dueDate'), b.dueDate ? [date(b.dueDate, 'iso'), b.paidAt ? h('span.muted', null, ' · ' + t('bill.paidOn', { date: b.paidAt })) : p.autopay ? h('span.muted', null, ' · ' + t('bill.autopay')) : !locked && b.dueDate >= D.today ? h('span.muted', null, ' · ' + relDays(dayNumber(b.dueDate) - dayNumber(D.today))) : null] : '—'),
      fact(t('bill.category'), t('splitcat.' + (p.category || 'internet')))),
    h('div.actions', null,
      h('button.btn', { type: 'button', onclick: () => openBillForm(ctx, { existing: b }) }, '✎ ' + t('bill.edit')),
      !p.autopay ? h('button.btn', { type: 'button', onclick: () => { ctx.put('bills', { ...b, paidAt: b.paidAt ? null : D.today }); } }, b.paidAt ? t('bill.unmarkPaid') : '✓ ' + t('bill.markPaid')) : null,
      h('button.btn', { type: 'button', disabled: !b.dueDate || !!b.paidAt || b.dueDate < D.today,
        title: !b.dueDate ? t('bill.calendarNoDate') : b.paidAt ? t('bill.calendarPaid') : b.dueDate < D.today ? t('bill.calendarPast') : t('bill.calendarHelp'),
        onclick: () => exportIcs(b, p) }, t('bill.calendar')),
      h('button.btn.danger', { type: 'button', onclick: () => del(ctx, b) }, t('bill.delete'))),
    billDocument(b)));

  // 分项
  const items = (b.items || []).filter(i => typeof i.amount === 'number');
  if (items.length) {
    const sum = items.reduce((a, i) => a + i.amount, 0);
    root.append(h('section.card', null, h('h2.section-h', null, t('bill.items')),
      h('table.data-table', null, h('tbody', null, items.map(i => h('tr', null,
        h('th', null, dot(ITEM_COLOR[i.key] || 'var(--ink-3)'), ' ', itemLabel(i), (() => {
          const dates = b.itemPeriods?.[i.key] || ctx.S.data.servicePeriods[b.id]?.items?.[i.key];
          return dates ? h('div.sub', null, period(dates.periodStart, dates.periodEnd, 'iso')) : null;
        })()),
        h('td.num', null, money(i.amount))))),
        h('tfoot', null, h('tr', null, h('th', null, t('split.total')), h('td.num', null, h('b', null, money(sum)))))),
      Math.abs(sum - b.total) > 0.005 ? h('p.note.warn-text', null, '⚠ ' + t('check.itemsSum', { sum, diff: Math.round((b.total - sum) * 100) / 100 })) : null));
    root.append(fieldGuide([...new Set(items.map(i => i.key))]));
  }
  const notes = billNotes(ctx, b); if (notes) root.append(notes);

  // 用量和单价
  const usage = Object.entries(st.usage);
  if (usage.length) {
    root.append(h('section.card', null, h('h2.section-h', null, t('bill.usage')),
      h('div.usage-grid', null, usage.map(([k, u]) => h('div.usage-cell', null,
        h('span.stat-label', null, t('usage.' + k)),
        h('span.stat-value.num', null, num(u.amount, u.amount % 1 ? 1 : 0), ' ', h('small', null, unitLabel(u.unit))),
        h('span.stat-sub', null, u.perDay != null ? t('usage.perDayVal', { v: num(u.perDay, u.perDay < 10 ? 2 : 1), unit: unitLabel(u.unit) }) : '',
          st.rates[k] ? ' · ' + rate(st.rates[k].value, st.rates[k].unit) : '')))),
      h('p.note', null, t('bill.rateNote'))));
  }

  const history = providerHistory(ctx, b.providerId); if (history) root.append(history);
  root.append(h('details.card', null, h('summary', null, t('bill.compare')), compareTable(b, ctx)));
  root.append(h('details.card', null, h('summary', null, t('rent.legacyRules')), splitTable(b, ctx, { onResident: resident => openResident(ctx, resident) }),
    locked ? h('button.link-btn', { type: 'button', onclick: () => unlock(ctx, b) }, t('bill.unlock'))
      : h('button.link-btn', { type: 'button', onclick: () => { const r = billShares(b, p, D.residents); ctx.put('bills', { ...b, allocation: { mode: 'locked', shares: r.shares } }); } }, t('bill.lock'))));

  // 来源
  const src = b.source || {};
  root.append(h('details.card.source', null, h('summary', null, t('bill.source')),
    h('dl.facts', null,
      fact(t('src.method'), t('src.' + (src.method || 'manual'))),
      src.file ? fact(t('src.file'), src.file) : null,
      src.sha256 ? fact('SHA-256', src.sha256.slice(0, 12) + '…') : null,
      src.parser ? fact(t('src.parser'), src.parser) : null,
      src.at ? fact(t('src.at'), new Date(src.at).toLocaleString()) : null)));
}

const fact = (k, v) => h('div', null, h('dt', null, k), h('dd', null, v));

export function itemLabel(i) {
  const known = t('item.' + i.key);
  return known !== 'item.' + i.key ? known : i.label || i.key;
}

function del(ctx, b) {
  if (!confirm(t('bill.deleteConfirm'))) return;
  const prev = ctx.remove('bills', b.id);
  ctx.nav('bills');
  ctx.toast(t('bill.deleted'), { action: t('undo'), onAction: () => ctx.put('bills', prev), ms: 10000 });
}

function unlock(ctx, b) {
  const p = providerOf(ctx, b);
  const now = billShares({ ...b, allocation: { mode: 'auto' } }, p, ctx.D.residents).shares;
  const old = b.allocation.shares || {};
  const ids = [...new Set([...Object.keys(old), ...Object.keys(now)])];
  const changed = ids.filter(id => Math.abs((old[id] || 0) - (now[id] || 0)) > 0.005);
  const sheet = openSheet({
    title: t('bill.unlockH'),
    body: h('div', null, h('p', null, t('bill.unlockP')),
      changed.length ? h('table.data-table', null, h('tbody', null, changed.map(id => h('tr', null, h('th', null, residentName(ctx, id)),
        h('td.num', null, money(old[id] || 0), ' → ', h('b', null, money(now[id] || 0))))))) : h('p.muted', null, t('bill.unlockSame'))),
    foot: [h('button.btn', { type: 'button', onclick: () => sheet.close() }, t('cancel')),
      h('button.btn.primary', { type: 'button', onclick: () => { ctx.put('bills', { ...b, allocation: { mode: 'auto' } }); sheet.close(); ctx.toast(t('bill.unlocked')); } }, t('bill.unlockGo'))],
  });
}

/** 到期提醒导出成日历文件（提前 3 天提醒），系统日历负责通知 */
function exportIcs(b, p) {
  const d = b.dueDate.replace(/-/g, '');
  const stampIso = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const esc = s => String(s).replace(/\\/g, '\\\\').replace(/[;,]/g, m => '\\' + m).replace(/\r?\n|\r/g, '\\n');
  if (!/^\d{8}$/.test(d)) return;
  const uid = String(b.id).replace(/[^\w.-]/g, '_');
  const title = t('ics.title', { provider: p.name, amount: b.total });
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//house-ledger//EN', 'BEGIN:VEVENT',
    `UID:${uid}@house-ledger`, `DTSTAMP:${stampIso}`, `DTSTART;VALUE=DATE:${d}`, `SUMMARY:${esc(title)}`,
    'BEGIN:VALARM', 'TRIGGER:-P3D', 'ACTION:DISPLAY', `DESCRIPTION:${esc(title)}`, 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  download(`${p.name.replace(/\W+/g, '-')}-${b.dueDate}.ics`, ics, 'text/calendar');
}
