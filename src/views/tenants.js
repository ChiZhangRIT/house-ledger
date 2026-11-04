// 房东自用的住户与房租首页。
import { h } from '../ui/dom.js';
import { t, money, date } from '../i18n.js';
import { rentOn } from '../core/ledger.js';
import { rentReceipts } from '../core/rent.js';
import { monthRange } from '../core/analytics.js';
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
  const month = D.today.slice(0, 7);
  const stat = (label, value) => h('div.stat', null, h('span.stat-label', null, label), h('span.stat-value.num', null, value));
  root.append(h('section.stats', null,
    stat(t('rent.living'), String(tenants.filter(r => r.moveIn <= D.today && (!r.moveOut || r.moveOut > D.today)).length)),
    stat(t('rent.receivedMonth'), money(receipts.payments.filter(p => p.date.startsWith(month)).reduce((s, p) => s + p.amount, 0))),
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
  const original = Object.values(ctx.S.data.rents).filter(r => !r.deleted && r.paid);
  const rawDates = original.map(r => r.periodStart.slice(0, 7)).sort();
  const rawMonths = rawDates.length ? monthRange(rawDates[0], rawDates.at(-1)) : [];
  const known = receipts.months.length > 0;
  const months = known ? receipts.months.slice(-24) : rawMonths.slice(-24);
  const chart = h('section.card.chart-card');
  if (months.length) {
    columnChart(chart, { title: t(known ? 'rent.receiptsChart' : 'rent.ticksChart'), labels: months.map(k => k.replace('-', '/')),
      series: [{ key: 'rent', name: t(known ? 'rent.receipts' : 'rent.confirmed'), color: 'var(--accent)',
        values: known ? receipts.values.slice(-24) : months.map(k => original.filter(r => r.periodStart.startsWith(k)).length || null) }],
      format: v => known ? money(v) : String(v), tickFormat: v => known ? money(v, { whole: v === 0 || Math.abs(v) >= 10 }) : Number.isInteger(v) ? String(v) : '',
      height: 220, tableLabel: t('viz.table'), xName: t(known ? 'rent.receiptMonth' : 'rent.sourcePeriod') });
    chart.append(h('p.note', null, t(known ? 'rent.receiptsNote' : 'rent.ticksNote')));
    root.append(chart);
  }
  const unclassified = Object.values(ctx.S.data.payments).filter(p => !p.deleted && p.purpose !== 'rent');
  if (unclassified.length) root.append(h('details.card', null, h('summary', null, t('rent.unclassified', { n: unclassified.length })),
    h('p.note', null, t('rent.unclassifiedHint')), unclassified.map(p => h('p.small', null, date(p.date), ' · ', money(p.amount), ' · ', p.note || '',
      h('button.link-btn', { type: 'button', onclick: () => { if (confirm(t('rent.classifyConfirm'))) ctx.put('payments', { ...p, purpose: 'rent' }); } }, t('rent.classify'))))));
}
