// 房东自用的住户与房租首页。
import { h } from '../ui/dom.js';
import { t, money, date, month } from '../i18n.js';
import { rentOn } from '../core/ledger.js';
import { rentReceipts, rentHistorySummary } from '../core/rent.js';
import { columnChart } from '../ui/charts.js';
import { avatar, statusChip } from './parts.js';
import { openResident } from './residents.js';
import { openPayment } from './money.js';

export function rentStatus(p) {
  if (!p || !p.items.length) return statusChip('none', t('rent.notStarted'));
  if (p.unknownRent.length) return statusChip('unknown', t('rent.unknown'));
  if (p.overdue > 0.005) return statusChip('critical', t('st.overdue', { amount: p.overdue, days: p.overdueDays }));
  if (p.outstanding > 0.005) return statusChip('warning', t('st.due', { amount: p.outstanding }));
  if (p.credit > 0.005) return statusChip('credit', t('st.credit', { amount: p.credit }));
  return statusChip('good', t('st.settled'));
}

export function render(root, ctx) {
  const D = ctx.D, receipts = rentReceipts(ctx.S), tenants = D.residents.filter(r => !r.isOwner);
  root.append(h('div.page-intro', null, h('p.muted', null, t('rent.intro')),
    h('div.row', null, h('button.btn', { type: 'button', onclick: () => openResident(ctx, null) }, '＋ ' + t('res.add')),
      tenants.length ? h('button.btn.primary', { type: 'button', onclick: () => openPayment(ctx) }, '＋ ' + t('rent.record')) : null)));
  const currentMonth = D.today.slice(0, 7);
  const stat = (label, value) => h('div.stat', null, h('span.stat-label', null, label), h('span.stat-value.num', null, value));
  root.append(h('section.stats', null,
    stat(t('rent.living'), String(tenants.filter(r => r.moveIn <= D.today && (!r.moveOut || r.moveOut > D.today)).length)),
    stat(t('rent.receivedMonth'), money(receipts.payments.filter(p => p.date.startsWith(currentMonth)).reduce((s, p) => s + p.amount, 0))),
    stat(t('rent.knownDue'), money(Object.values(D.ledger.people).reduce((s, p) => s + p.overdue, 0)))));
  if (Object.values(D.ledger.people).some(p => p.unknownRent.length)) root.append(h('p.note', null, t('rent.unknownHint')));
  for (const [label, list] of [[t('res.living'), D.residents.filter(r => !r.moveOut || r.moveOut > D.today)], [t('res.movedOut'), D.residents.filter(r => r.moveOut && r.moveOut <= D.today)]]) {
    if (!list.length) continue;
    const people = h('div.people', null, list.map(r => {
      const rent = rentOn(r, D.today);
      return h('a.person', { href: '#/person/' + encodeURIComponent(r.id) }, avatar(r),
        h('span.person-name', null, r.name, r.isOwner ? h('span.badge', null, t('res.owner')) : null,
          h('small.muted.block', null, date(r.moveIn, 'num'), ' – ', r.moveOut ? date(r.moveOut, 'num') : t('res.now'))),
        h('span.person-amt', null, r.isOwner ? '' : rent == null ? t('rent.monthlyUnknown') : t('res.rentNow', { amount: rent })),
        !r.isOwner ? rentStatus(D.ledger.people[r.id]) : null);
    }));
    root.append(label === t('res.movedOut') ? h('details.card', null, h('summary', null, label + ' · ' + list.length), people)
      : h('section.card', null, h('h2.section-h', null, label), people));
  }
  const history = rentHistorySummary(ctx.S);
  if (history.values.some(v => v != null)) {
    const chart = h('section.card.chart-card');
    columnChart(chart, { title: t('rent.historyChart'), labels: history.months.map(k => k.replace('-', '/')),
      longLabels: history.months.map((k, i) => month(k) + (history.partial[i] ? ' · ' + t('rent.historyPartial') : '')),
      series: [{ key: 'rent', name: t('rent.receivedAmount'), color: 'var(--accent)', values: history.values }], partial: history.partial,
      visibleCount: 12, format: v => money(v), tickFormat: v => money(v, { whole: v === 0 || Math.abs(v) >= 10 }),
      height: 220, tableLabel: t('viz.table'), xName: t('rent.month') });
    chart.append(h('p.note', null, t('rent.historyChartNote'))); root.append(chart);
  }
  if (history.missing.length) root.append(h('section.card', null, h('h2.section-h', null, t('rent.historyMissing')),
    h('p.note', null, t('rent.historyMissingHint')),
    h('div.people', null, tenants.filter(r => history.missing.some(x => x.residentId === r.id)).map(r => {
      const records = history.missing.filter(x => x.residentId === r.id);
      return h('a.person', { href: '#/person/' + encodeURIComponent(r.id) }, avatar(r), h('span.person-name', null, r.name),
        h('span.small.muted', null, t('rent.missingMonths', { n: records.length })), h('span.person-amt', null, t('rent.completeHistory') + ' ›'));
    }))));
  if (receipts.months.length) {
    const chart = h('section.card.chart-card');
    columnChart(chart, { title: t('rent.receiptsChart'), labels: receipts.months.map(k => k.replace('-', '/')),
      series: [{ key: 'rent', name: t('rent.receipts'), color: 'var(--accent)', values: receipts.values }], visibleCount: 12,
      format: v => money(v), tickFormat: v => money(v, { whole: v === 0 || Math.abs(v) >= 10 }),
      height: 220, tableLabel: t('viz.table'), xName: t('rent.receiptMonth') });
    chart.append(h('p.note', null, t('rent.receiptsNote'))); root.append(chart);
  }
  const unclassified = Object.values(ctx.S.data.payments).filter(p => !p.deleted && p.purpose !== 'rent');
  if (unclassified.length) root.append(h('details.card', null, h('summary', null, t('rent.unclassified', { n: unclassified.length })),
    h('p.note', null, t('rent.unclassifiedHint')), unclassified.map(p => h('p.small', null, date(p.date), ' · ', money(p.amount), ' · ', p.note || '',
      h('button.link-btn', { type: 'button', onclick: () => { if (confirm(t('rent.classifyConfirm'))) ctx.put('payments', { ...p, purpose: 'rent' }); } }, t('rent.classify'))))));
}
