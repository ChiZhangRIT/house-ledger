// 同一公司每张账单的金额构成，分项和账单记录一致；用量不参与堆叠。
import { h } from '../ui/dom.js';
import { t, money, date, period } from '../i18n.js';
import { columnChart } from '../ui/charts.js';
import { ITEM_COLOR, providerColor } from '../ui/colors.js';
import { billCostSeries } from '../core/utilities.js';

export function providerHistory(ctx, providerId) {
  const provider = ctx.D.providers[providerId];
  const bills = ctx.D.bills.filter(b => b.providerId === providerId).sort((a, b) => a.statementDate.localeCompare(b.statementDate));
  if (!provider || !bills.length) return null;
  const series = billCostSeries(bills).map(s => {
    const name = t('item.' + s.key);
    return { ...s, name: name === 'item.' + s.key ? s.label : name, color: ITEM_COLOR[s.key] || providerColor(provider) };
  });
  const card = h('section.card.chart-card.provider-history');
  columnChart(card, { title: t('bills.providerCost', { name: provider.name }),
    labels: bills.map(b => b.statementDate.slice(0, 7).replace('-', '/')),
    longLabels: bills.map(b => `${date(b.statementDate, 'iso')} · ${period(b.periodStart, b.periodEnd, 'iso')}`),
    series, stacked: true, visibleCount: 12, format: v => money(v), tickFormat: v => money(v, { whole: v === 0 || Math.abs(v) >= 10 }),
    totalLabel: t('viz.total'), tableLabel: t('viz.table'), xName: t('field.statementDate'), height: 260,
    onSelect: i => ctx.nav('bill/' + encodeURIComponent(bills[i].id)) });
  card.append(h('p.note', null, t('bills.providerCostNote', { n: bills.length })));
  return card;
}
