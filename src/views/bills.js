// 账单列表：按公司、年份筛选，按年分组，组标题显示合计
import { h } from '../ui/dom.js';
import { t } from '../i18n.js';
import { providerColor } from '../ui/colors.js';
import { billRow, dot, emptyState } from './parts.js';

export function render(root, ctx) {
  const D = ctx.D, prefs = ctx.L.prefs;
  const prov = prefs.billsProvider && D.providers[prefs.billsProvider] ? prefs.billsProvider : 'all';
  const years = [...new Set(D.bills.map(b => b.statementDate.slice(0, 4)))].sort().reverse();
  const year = years.includes(prefs.billsYear) ? prefs.billsYear : 'all';
  const set = (k, v) => { ctx.setPref(k, v); ctx.render(); };

  root.append(h('div.filters', { role: 'toolbar', 'aria-label': t('bills.filter') },
    h('div.chips', null,
      chip(t('bills.all'), prov === 'all', () => set('billsProvider', 'all'), 'all'),
      D.providerList.filter(p => D.bills.some(b => b.providerId === p.id)).map(p => chip([dot(providerColor(p)), p.name], prov === p.id, () => set('billsProvider', p.id), p.id))),
    h('label.select', null, h('span.sr-only', null, t('bills.year')),
      h('select', { onchange: e => set('billsYear', e.target.value) },
        h('option', { value: 'all', selected: year === 'all' }, t('bills.allYears')),
        years.map(y => h('option', { value: y, selected: y === year }, y)))),
    h('button.btn.primary', { type: 'button', onclick: () => ctx.openAdd() }, '＋ ' + t('nav.add'))));

  const list = D.bills.filter(b => (prov === 'all' || b.providerId === prov) && (year === 'all' || b.statementDate.startsWith(year)));
  if (!list.length) { root.append(emptyState(D.bills.length ? t('bills.noneFiltered') : t('bills.none'))); return; }
  const groups = new Map();
  for (const b of list) { const y = b.statementDate.slice(0, 4); if (!groups.has(y)) groups.set(y, []); groups.get(y).push(b); }
  for (const [y, items] of groups) {
    const sum = items.reduce((a, b) => a + (b.total || 0), 0);
    root.append(h('section.card.bill-group', null,
      h('h2.section-h', null, y, h('span.muted.num', null, t('bills.groupSum', { n: items.length, amount: sum }))),
      h('div.bill-list', null, items.map(b => billRow(b, ctx, { showProvider: prov === 'all' })))));
  }
  root.append(h('p.note', null, t('bills.byStatement')));
}

const chip = (label, on, onclick, fid) => h('button.chip' + (on ? '.on' : ''), { type: 'button', 'aria-pressed': String(on), onclick, 'data-fid': 'bills-chip-' + fid }, label);
