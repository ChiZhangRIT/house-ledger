// 账单主页：最新原始账单 + 每项 Utility 的独立图表与记录。
import { h } from '../ui/dom.js';
import { t, money, period, date, num, pct } from '../i18n.js';
import { columnChart } from '../ui/charts.js';
import { UTILITIES, UTILITY_INFO, utilityRows, billCostSeries, utilityYearComparison } from '../core/utilities.js';
import { ITEM_COLOR } from '../ui/colors.js';
import { emptyState } from './parts.js';
import { fieldGuide } from './notes.js';

export function render(root, ctx) {
  const D = ctx.D, prefs = ctx.L.prefs;
  root.append(h('div.page-intro', null, h('p.muted', null, t('bills.intro')),
    h('button.btn.primary', { type: 'button', onclick: () => ctx.openAdd() }, '＋ ' + t('nav.add'))));
  if (!D.bills.length) { root.append(emptyState(t('bills.none'))); return; }
  const latest = ['energy', 'water', 'internet'].map(cat => D.bills.find(b => D.providers[b.providerId]?.category === cat)).filter(Boolean);
  root.append(h('section', null, h('h2.section-h', null, t('ov.latest')), h('div.latest-grid', null, latest.map(b =>
    h('a.latest-card', { href: '#/bill/' + encodeURIComponent(b.id) },
      h('b', null, D.providers[b.providerId].name), h('div.latest-amt.num', null, money(b.total)),
      h('div.small.muted', null, D.providers[b.providerId].category === 'water' ? t('u.meterPeriod') + ' ' : '', period(b.periodStart, b.periodEnd, 'iso')),
      h('div.small.muted', null, t('bills.issued') + ' ' + date(b.statementDate, 'iso')))))));
  const key = UTILITIES.includes(prefs.utility) ? prefs.utility : 'electricity';
  const info = UTILITY_INFO[key], all = utilityRows(D.bills, D.providers, key, ctx.S.data.servicePeriods);
  const range = ['12', '24', 'all'].includes(prefs.utilityRange) ? prefs.utilityRange : '12';
  const daily = prefs.utilityMetric === 'daily';
  const rows = range === 'all' ? all : all.slice(-Number(range));
  const set = (k, v) => { ctx.setPref(k, v); ctx.render(); };
  root.append(h('section.card.utility-controls', null,
    h('h2.section-h', null, t('u.browse')),
    h('div.seg-tabs.utility-tabs', { role: 'tablist', 'aria-label': t('u.choose') }, UTILITIES.map(k =>
      h('button.seg-tab' + (key === k ? '.on' : ''), { type: 'button', role: 'tab', 'aria-selected': String(key === k), onclick: () => set('utility', k) }, t(k === 'electricity' ? 'u.electricityTab' : 'u.' + k))))));
  if (!rows.length) { root.append(emptyState(t('an.noData'))); return; }
  if (key === 'electricity') root.append(h('p.utility-explanation', null, t('u.electricityNote')));
  const last = all.at(-1), prev = all.at(-2);
  const stat = (label, val, note) => h('div.stat', null, h('span.stat-label', null, label), h('span.stat-value.num', null, val), h('span.stat-sub', null, note));
  const dates = r => h('span', null, r?.start ? t('u.servicePeriod') + ' ' + period(r.start, r.end, 'iso') : t('u.unknownPeriod'));
  const totalNote = r => [dates(r), r?.days > 0 ? h('span', null, t('u.periodTotal', { n: r.days })) : null];
  root.append(h('section.stats.utility-stats', null,
    stat(t('u.latestCost'), money(last.amount), totalNote(last)),
    info.unit ? stat(t('u.latestUsage'), last.usage == null ? '—' : num(last.usage, last.usage % 1 ? 1 : 0) + ' ' + info.unit, totalNote(last))
      : stat(t('u.previousCost'), money(prev?.amount), totalNote(prev)),
    stat(t('u.dailyCost'), last.perDay == null ? '—' : money(last.perDay) + t('u.perDaySuffix'),
      [dates(last), last.days > 0 && last.amount != null ? h('span', null, t('u.dailyFormula', { amount: money(last.amount), n: last.days })) : null])));
  root.append(h('p.note', null, t('u.amountBasis')));
  root.append(h('div.chart-controls', null,
    h('div.seg-tabs', { role: 'group', 'aria-label': t('u.metric') }, ['total', 'daily'].map(m =>
      h('button.seg-tab' + ((m === 'daily') === daily ? '.on' : ''), { type: 'button', 'aria-pressed': String((m === 'daily') === daily), onclick: () => set('utilityMetric', m) }, t('u.metric.' + m)))),
    h('label.select', null, h('span.sr-only', null, t('u.range')), h('select', { 'aria-label': t('u.range'), onchange: e => set('utilityRange', e.target.value) },
      ['12', '24', 'all'].map(r => h('option', { value: r, selected: r === range }, t('u.range.' + r)))))));
  const comparisons = daily ? new Map(all.map(r => [r.bill.id, utilityYearComparison(r, all)])) : null;
  const chart = (field, title, format, tickFormat) => {
    const el = h('section.card.chart-card');
    const stacked = !daily && key === 'electricity' && field === 'amount';
    const valueKey = field === 'usage' ? 'usagePerDay' : 'perDay';
    const series = daily ? [
      { key, name: t('u.dailyRecorded'), color: info.color, values: rows.map(r => r[valueKey]) },
      { key: 'lastYear', name: t('u.dailyLastYear'), color: 'var(--viz-muted)', values: rows.map(r => comparisons.get(r.bill.id)?.[valueKey] ?? null) },
    ] : stacked ? billCostSeries(rows.map(r => ({ ...r.bill, total: r.amount ?? 0, items: (r.bill.items || []).filter(i => info.items.includes(i.key)) })))
      .map(s => ({ ...s, name: t('item.' + s.key), color: ITEM_COLOR[s.key] || info.color }))
      : [{ key, name: t('u.' + key), color: info.color, values: rows.map(r => r[field]) }];
    columnChart(el, { title, labels: rows.map(r => r.bill.statementDate.slice(0, 7).replace('-', '/')),
      longLabels: rows.map(r => {
        const ref = comparisons?.get(r.bill.id);
        return `${date(r.bill.statementDate, 'iso')} · ${r.start ? period(r.start, r.end, 'iso') : t('u.unknownPeriod')}`
          + (daily ? ` · ${ref ? t('u.referencePeriod') + ' ' + period(ref.start, ref.end, 'iso') : t('u.yoyMissing')}` : '');
      }),
      series, stacked, visibleCount: 12, totalLabel: t('viz.total'),
      tableLabel: t('viz.table'), xName: t('field.statementDate'), format, tickFormat, height: 240,
      onSelect: i => ctx.nav('bill/' + encodeURIComponent(rows[i].bill.id)) });
    return el;
  };
  root.append(h('div.utility-charts', null,
    info.unit && rows.some(r => r.usage != null) ? chart('usage', t(daily ? 'u.dailyUsageChart' : 'u.usageChart', { name: t('u.' + key), unit: info.unit }),
      v => num(v, daily ? 2 : v % 1 ? 1 : 0) + ' ' + info.unit + (daily ? t('u.perDaySuffix') : ''), v => num(v, daily && Math.abs(v) < 10 ? 2 : 0)) : null,
    chart('amount', daily ? t('u.dailyCostChart', { name: t('u.' + key) }) : key === 'electricity' ? t('u.electricityCostChart') : t('u.costChart', { name: t('u.' + key) }),
      v => money(v) + (daily ? t('u.perDaySuffix') : ''), v => money(v, { whole: v === 0 || Math.abs(v) >= 10 }))));
  if (daily) {
    const ref = comparisons.get(last.bill.id);
    root.append(h('p.yoy-summary', null, ref ? [t('u.latestYoy') + ' · ',
      info.unit ? t('u.dailyUsageLabel') + ' ' + pct(ref.usageChange) + ' · ' : '', t('u.dailyCost') + ' ' + pct(ref.costChange),
      h('span', null, t('u.referencePeriod') + ' ' + period(ref.start, ref.end, 'iso'))] : t('u.yoyMissing')),
    h('p.note', null, t('u.dailyMethod')));
  }
  root.append(h('p.note', null, t('u.chartNote')));
  root.append(fieldGuide(info.items || ['internet', 'taxes', 'partial_charges', 'account_charges']));
  root.append(h('section.card', null, h('h2.section-h', null, t('u.history', { name: t('u.' + key) })),
    h('p.note.history-count', null, t('u.allHistory', { n: all.length, from: date(all[0].bill.statementDate, 'iso'), to: date(all.at(-1).bill.statementDate, 'iso') })),
    h('div.table-scroll', null, h('table.data-table.utility-history', null,
      h('thead', null, h('tr', null, [t('field.statementDate'), t('field.periodStart'), t('field.periodEnd'), t('field.providerId'), ...(info.unit ? [t('bill.usage')] : []), t('u.cost')].map(x => h('th', null, x)))),
      h('tbody', null, [...all].reverse().map(r => h('tr', null,
        h('th.date-cell', { scope: 'row' }, h('a', { href: '#/bill/' + encodeURIComponent(r.bill.id) }, date(r.bill.statementDate, 'iso'))),
        h('td.date-cell', null, date(r.start, 'iso')), h('td.date-cell', null, date(r.end, 'iso')), h('td', null, D.providers[r.bill.providerId]?.name),
        info.unit ? h('td.num', null, r.usage == null ? '—' : num(r.usage, r.usage % 1 ? 1 : 0) + ' ' + info.unit) : null,
        h('td.num', null, money(r.amount)))))))));
}
