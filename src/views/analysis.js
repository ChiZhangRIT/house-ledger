// 分析：月度花费、季节对比（每年一条线）、用量、单价、分项、人均。
// 所有月度数字都按服务周期天数摊到自然月；不同长度的账单用「每天」比较。不画双 y 轴：不同单位各画一张图。
import { h } from '../ui/dom.js';
import { t, money, month, num, pct, unitLabel, rate as fmtRate, date } from '../i18n.js';
import { columnChart, lineChart } from '../ui/charts.js';
import { CAT_COLOR, ITEM_COLOR, ITEM_STACKS } from '../ui/colors.js';
import { CATEGORIES, addMonths, monthDays, periodSummary, billStats, nextMonth } from '../core/analytics.js';
import { personDays, participates } from '../core/split.js';
import { changeTag, emptyState } from './parts.js';

const TABS = ['monthly', 'season', 'usage', 'rates', 'items', 'perPerson'];

export function render(root, ctx) {
  const D = ctx.D, prefs = ctx.L.prefs;
  if (!D.bills.length) { root.append(emptyState(t('bills.none'))); return; }
  const tab = TABS.includes(prefs.anTab) ? prefs.anTab : 'monthly';
  const range = ['12', '24', 'all'].includes(prefs.anRange) ? prefs.anRange : '24';
  const set = (k, v) => { ctx.setPref(k, v); ctx.render(); };
  root.append(h('div.filters', null,
    h('div.seg-tabs', { role: 'tablist' }, TABS.map(x => h('button.seg-tab' + (x === tab ? '.on' : ''), { type: 'button', role: 'tab', 'aria-selected': String(x === tab), 'data-fid': 'an-tab-' + x, onclick: () => set('anTab', x) }, t('an.' + x)))),
    tab !== 'season' && tab !== 'rates' ? h('div.seg-tabs.small', { role: 'group', 'aria-label': t('an.range') }, ['12', '24', 'all'].map(x => h('button.seg-tab' + (x === range ? '.on' : ''), { type: 'button', 'aria-pressed': String(x === range), 'data-fid': 'an-range-' + x, onclick: () => set('anRange', x) }, t('an.range.' + x)))) : null));
  const body = h('div.an-body');
  root.append(body);
  ({ monthly, season, usage, rates, items, perPerson })[tab](body, ctx, range);
}

const sliceFrom = (arr, range) => (range === 'all' ? 0 : Math.max(0, arr.length - Number(range)));
const chartCard = (parent, note) => { const c = h('section.card.chart-card'); parent.append(c); return { c, note: () => note && c.append(h('p.note', null, note)) }; };
const common = () => ({ tableLabel: t('viz.table'), totalLabel: t('viz.total'), xName: t('viz.month') });

// ---------- 月度花费 ----------
function monthly(root, ctx, range) {
  const m = ctx.D.monthly;
  const from = sliceFrom(m.months, range), months = m.months.slice(from);
  const lastIdx = m.complete.lastIndexOf(true);
  if (lastIdx >= 0) {
    const key = m.months[lastIdx];
    const y1 = periodSummary(m.months, m.total, m.complete, addMonths(key, -11), key), y0 = periodSummary(m.months, m.total, m.complete, addMonths(key, -23), addMonths(key, -12));
    const ytdFrom = key.slice(0, 4) + '-01';
    const a = periodSummary(m.months, m.total, m.complete, ytdFrom, key), b = periodSummary(m.months, m.total, m.complete, addMonths(ytdFrom, -12), addMonths(key, -12));
    root.append(h('section.stats', null,
      statBox(t('an.last12'), money(y1.sum, { whole: true }), y0.months === 12 ? [changeTag((y1.sum - y0.sum) / y0.sum), ' ', t('an.vsPrior12')] : ''),
      statBox(t('an.ytd', { year: key.slice(0, 4) }), money(a.sum, { whole: true }), b.months === a.months && b.sum ? [changeTag((a.sum - b.sum) / b.sum), ' ', t('an.vsSamePeriod')] : ''),
      statBox(t('an.avgMonth'), money(y1.avg), t('an.basedOn', { n: y1.months }))));
  }
  const { c, note } = chartCard(root, t('ov.chartNote'));
  columnChart(c, {
    ...common(), title: t('an.monthlyTitle'),
    labels: months.map(k => month(k, 'axis')), longLabels: months.map((k, i) => month(k) + (m.complete[from + i] ? '' : ' · ' + t('viz.partial'))),
    series: CATEGORIES.map(cat => ({ key: cat, name: t('cat.' + cat), color: CAT_COLOR[cat], values: m.byCat[cat].slice(from) })),
    partial: m.complete.slice(from).map(x => !x), stacked: true, format: v => money(v), tickFormat: v => money(v, { whole: true }), height: 260,
  });
  note();
  // 和去年同月比的表
  const rows = months.map((k, i) => ({ k, v: m.total[from + i], ly: m.total[m.months.indexOf(addMonths(k, -12))], ok: m.complete[from + i] })).filter(r => r.ok).reverse();
  root.append(h('section.card', null, h('h2.section-h', null, t('an.yoyTable')),
    h('div.table-scroll', null, h('table.data-table', null,
      h('thead', null, h('tr', null, h('th', null, t('viz.month')), CATEGORIES.map(cat => h('th.num', null, t('cat.' + cat))), h('th.num', null, t('viz.total')), h('th.num', null, t('an.lastYearSame')), h('th.num', null, t('an.change')))),
      h('tbody', null, rows.map(r => {
        const i = m.months.indexOf(r.k);
        return h('tr', null, h('th', null, month(r.k)), CATEGORIES.map(cat => h('td.num', null, m.byCat[cat][i] == null ? '—' : money(m.byCat[cat][i]))),
          h('td.num', null, h('b', null, money(r.v))), h('td.num.muted', null, r.ly != null ? money(r.ly) : '—'), h('td.num', null, r.ly ? pct((r.v - r.ly) / r.ly) : '—'));
      }))))));
}

// ---------- 季节对比：横轴 1–12 月，每年一条线 ----------
function season(root, ctx) {
  const prefs = ctx.L.prefs, m = ctx.D.monthly, u = ctx.D.usage;
  const METRICS = [...CATEGORIES.map(c => 'cost:' + c), 'cost:total', ...Object.keys(u.byKey).filter(k => k !== 'data').map(k => 'use:' + k)];
  const metric = METRICS.includes(prefs.anMetric) ? prefs.anMetric : 'cost:total';
  root.append(h('div.filters', null, h('label.select', null, h('span', null, t('an.metric')),
    h('select', { onchange: e => { ctx.setPref('anMetric', e.target.value); ctx.render(); } },
      METRICS.map(x => h('option', { value: x, selected: x === metric }, metricLabel(x, u)))))));
  const [kind, key] = metric.split(':');
  const src = kind === 'cost' ? (key === 'total' ? m.total : m.byCat[key]) : u.byKey[key];
  const months = kind === 'cost' ? m.months : u.months;
  const complete = kind === 'cost' ? m.complete : months.map(k => m.complete[m.months.indexOf(k)] !== false);
  // 每天的值，月份长短不影响
  const perDay = {};
  months.forEach((k, i) => { if (src[i] != null && complete[i]) { const y = k.slice(0, 4); (perDay[y] = perDay[y] || Array(12).fill(null))[Number(k.slice(5)) - 1] = src[i] / monthDays(k); } });
  const years = Object.keys(perDay).sort();
  if (!years.length) { root.append(emptyState(t('an.noData'))); return; }
  const color = kind === 'cost' ? (key === 'total' ? 'var(--viz-accent)' : CAT_COLOR[key]) : CAT_COLOR[key === 'water' ? 'water' : key === 'gas' ? 'gas' : 'electricity'];
  const cur = years[years.length - 1], prev = years[years.length - 2];
  const unit = kind === 'use' ? unitLabel(u.units[key]) : null;
  const fmt = v => (kind === 'cost' ? money(v) : num(v, v < 10 ? 2 : 1) + ' ' + unit);
  const { c, note } = chartCard(root, t('an.seasonNote'));
  lineChart(c, {
    ...common(), title: metricLabel(metric, u) + ' · ' + t('an.perDay'),
    labels: Array.from({ length: 12 }, (_, i) => month(`2000-${String(i + 1).padStart(2, '0')}`, 'short')),
    series: years.map(y => ({ key: y, name: y, values: perDay[y], color: y === cur ? color : 'var(--ink-2)', muted: y !== cur && y !== prev, thin: y === prev })).reverse(),
    format: fmt, tickFormat: v => (kind === 'cost' ? money(v, { whole: v === 0 || v >= 10 }) : num(v, v < 10 ? 1 : 0)), height: 260,
  });
  note();
}
function metricLabel(x, u) {
  const [kind, key] = x.split(':');
  if (kind === 'cost') return key === 'total' ? t('an.costTotal') : t('an.costOf', { cat: t('cat.' + key) });
  return t('usage.' + key) + ' (' + unitLabel(u.units[key]) + ')';
}

// ---------- 用量：每月日均，各画一张 ----------
function usage(root, ctx, range) {
  const u = ctx.D.usage, m = ctx.D.monthly;
  const keys = Object.keys(u.byKey).filter(k => k !== 'data');
  if (!keys.length) { root.append(emptyState(t('an.noUsage'))); return; }
  const from = sliceFrom(u.months, range), months = u.months.slice(from);
  for (const k of keys) {
    const vals = u.byKey[k].slice(from).map((v, i) => (v == null ? null : Math.round(v / monthDays(months[i]) * 100) / 100));
    const { c, note } = chartCard(root);
    const unit = unitLabel(u.units[k]);
    columnChart(c, {
      ...common(), title: t('usage.' + k) + ' · ' + t('an.perDayUnit', { unit }),
      labels: months.map(x => month(x, 'axis')), longLabels: months.map(x => month(x)),
      series: [{ key: k, name: t('usage.' + k), color: CAT_COLOR[k === 'electricity' ? 'electricity' : k], values: vals }],
      partial: months.map(x => m.complete[m.months.indexOf(x)] === false),
      format: v => num(v, 2) + ' ' + unit, tickFormat: v => num(v, v < 10 && v % 1 ? 1 : 0), height: 180,
    });
  }
  root.append(h('p.note', null, t('an.usageNote')));
}

// ---------- 单价：按账单，电 $/kWh、气 $/therm、水 $/CCF ----------
function rates(root, ctx) {
  const bills = [...ctx.D.bills].reverse();
  const keys = ['electricity', 'gas', 'water'];
  let any = false;
  for (const k of keys) {
    const pts = bills.map(b => ({ b, r: billStats(b).rates[k] })).filter(x => x.r);
    if (pts.length < 2) continue;
    any = true;
    const unit = pts[0].r.unit;
    const { c } = chartCard(root);
    lineChart(c, {
      ...common(), xName: t('field.statementDate'), title: t('rate.' + k),
      labels: pts.map(x => month(x.b.statementDate.slice(0, 7), 'axis')), longLabels: pts.map(x => date(x.b.statementDate)),
      series: [{ key: k, name: t('rate.' + k), color: CAT_COLOR[k], values: pts.map(x => Math.round(x.r.value * 1000) / 1000) }],
      format: v => fmtRate(v, unit), tickFormat: v => money(v, { whole: false }).replace(/\.00$/, ''), height: 200, zeroBased: false,
    });
    // 每年的平均单价 = 全年金额 ÷ 全年用量
    const byYear = {};
    for (const x of pts) {
      const y = x.b.statementDate.slice(0, 4), st = billStats(x.b);
      const o = byYear[y] || (byYear[y] = { cost: 0, use: 0 });
      o.cost += st.rates[k].value * st.usage[k].amount; o.use += st.usage[k].amount;
    }
    c.append(h('div.year-rates', null, Object.entries(byYear).map(([y, o]) => h('span', null, y + ' ', h('b', null, fmtRate(o.cost / o.use, unit))))));
  }
  if (!any) root.append(emptyState(t('an.noUsage')));
  else root.append(h('p.note', null, t('an.rateNote')));
}

// ---------- 分项：PG&E（发电 / 输配 / 燃气）、市政（水 / 垃圾 / 污水），每张账单一根柱 ----------
function items(root, ctx, range) {
  for (const [parser, keys] of Object.entries(ITEM_STACKS)) {
    const p = ctx.D.providerList.find(x => x.parser === parser);
    if (!p) continue;
    const list = ctx.D.bills.filter(b => b.providerId === p.id).reverse();
    const from = sliceFrom(list, range === 'all' ? 'all' : String(parser === 'sunnyvale' ? Math.ceil(Number(range) / 2) : Number(range)));
    const bills = list.slice(from);
    if (!bills.length) continue;
    const val = (b, k) => { const it = (b.items || []).filter(i => i.key === k); return it.length ? Math.round(it.reduce((a, i) => a + i.amount, 0) * 100) / 100 : null; };
    const { c, note } = chartCard(root, parser === 'pge' ? t('an.itemsNotePge') : t('an.itemsNoteCity'));
    columnChart(c, {
      ...common(), xName: t('field.statementDate'), title: p.name,
      labels: bills.map(b => month(b.statementDate.slice(0, 7), 'axis')), longLabels: bills.map(b => date(b.statementDate)),
      series: keys.map(k => ({ key: k, name: t('item.' + k), color: ITEM_COLOR[k], values: bills.map(b => val(b, k)) })),
      stacked: true, format: v => money(v), tickFormat: v => money(v, { whole: true }), height: 240,
    });
    note();
  }
}

// ---------- 人均：每个「人·天」多少钱（全参与的住户） ----------
function perPerson(root, ctx, range) {
  const m = ctx.D.monthly, res = ctx.D.residents;
  const from = sliceFrom(m.months, range), months = m.months.slice(from);
  const SPLIT = { electricity: 'energy', gas: 'energy', water: 'water', internet: 'internet' };
  const series = CATEGORIES.map(cat => ({
    key: cat, name: t('cat.' + cat), color: CAT_COLOR[cat],
    values: months.map((k, i) => {
      const v = m.byCat[cat][from + i];
      if (v == null || !m.complete[from + i]) return null;
      const pd = res.filter(r => participates(r, SPLIT[cat])).reduce((a, r) => a + personDays(r, k + '-01', nextMonth(k) + '-01'), 0);
      return pd ? Math.round(v / pd * 100) / 100 : null;
    }),
  }));
  const { c, note } = chartCard(root, t('an.perPersonNote'));
  columnChart(c, {
    ...common(), title: t('an.perPersonTitle'),
    labels: months.map(k => month(k, 'axis')), longLabels: months.map(k => month(k)),
    series, stacked: true, format: v => money(v), tickFormat: v => money(v, { whole: false }), height: 240,
  });
  note();
  // 每月在住的加权人数（平均）
  const heads = months.map(k => Math.round(res.reduce((a, r) => a + personDays(r, k + '-01', nextMonth(k) + '-01'), 0) / monthDays(k) * 10) / 10);
  const c2 = chartCard(root).c;
  columnChart(c2, {
    ...common(), title: t('an.headcount'),
    labels: months.map(k => month(k, 'axis')), longLabels: months.map(k => month(k)),
    series: [{ key: 'heads', name: t('an.headcount'), color: 'var(--viz-accent)', values: heads }],
    format: v => num(v, 1), tickFormat: v => num(v), height: 150,
  });
}

const statBox = (label, value, sub) => h('div.stat', null, h('span.stat-label', null, label), h('span.stat-value.num', null, value), h('span.stat-sub', null, sub));
