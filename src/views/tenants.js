// 房东自用的住户与房租首页。
import { h } from '../ui/dom.js';
import { t, money, date, month } from '../i18n.js';
import { rentOn } from '../core/ledger.js';
import { rentReceipts, rentReceiptYear, rentRecordSummary } from '../core/rent.js';
import { avatar, statusChip } from './parts.js';
import { openResident } from './residents.js';
import { openPayment } from './money.js';
import { isHousingPayment } from '../core/payments.js';

export function rentStatus(p) {
  if ((p?.unassignedPayments?.length || p?.unassignedAdjustments?.length)) return statusChip('unknown', t('housing.unassigned'));
  if (p?.trackingNotStarted) return statusChip('none', t('rent.trackingNotStarted'));
  if (p?.scheduleMissing) return statusChip('unknown', t('rent.scheduleMissing'));
  if (!p || !p.items.length) return statusChip('none', t('rent.notStarted'));
  if (p.unknownRent.length || p.incompletePeriods?.length || p.incompleteReceipts?.length) return statusChip('unknown', t('rent.unknown'));
  if (p.hasUnmatchedCredit) return statusChip(Math.abs(p.balance) < 0.005 ? 'good' : 'warning', t(Math.abs(p.balance) < 0.005 ? 'housing.rentBalanced' : p.balance > 0 ? 'housing.netDue' : 'housing.netCredit', { amount: Math.abs(p.balance) }));
  if (p.overdue > 0.005) return statusChip('critical', t('st.overdue', { amount: p.overdue, days: p.overdueDays }));
  if (p.outstanding > 0.005) return statusChip('warning', t('st.due', { amount: p.outstanding }));
  if (p.credit > 0.005) return statusChip('credit', t('st.credit', { amount: p.credit }));
  return statusChip('good', t('housing.rentSettled'));
}

export function render(root, ctx) {
  const D = ctx.D, receipts = rentReceipts(ctx.S), tenants = D.residents.filter(r => !r.isOwner);
  root.append(h('div.page-intro', null, h('p.muted', null, t('rent.intro')),
    h('div.row', null, h('button.btn', { type: 'button', onclick: () => openResident(ctx, null) }, '＋ ' + t('res.add')),
      tenants.length ? h('button.btn.primary', { type: 'button', onclick: () => openPayment(ctx) }, '＋ ' + t('housing.record')) : null)));
  const currentMonth = D.today.slice(0, 7);
  const stat = (label, value) => h('div.stat', null, h('span.stat-label', null, label), h('span.stat-value.num', null, value));
  root.append(h('section.stats', null,
    stat(t('rent.living'), String(tenants.filter(r => r.moveIn <= D.today && (!r.moveOut || r.moveOut > D.today)).length)),
    stat(t('rent.receivedMonth'), money(receipts.payments.filter(p => p.date.startsWith(currentMonth)).reduce((s, p) => s + p.amount, 0))),
    stat(t('rent.knownDue'), money(Object.values(D.ledger.people).reduce((s, p) => s + ((p.hasUnmatchedCredit || p.unassignedPayments.length || p.unassignedAdjustments.length || p.incompleteReceipts?.length || p.incompletePeriods?.length) ? 0 : p.overdue), 0)))));
  if (Object.values(D.ledger.people).some(p => p.unknownRent.length || p.scheduleMissing || p.unassignedPayments.length || p.unassignedAdjustments.length || p.incompleteReceipts?.length || p.incompletePeriods?.length)) root.append(h('p.note', null, t('rent.unknownHint')));
  if (Object.values(D.ledger.people).some(p => p.hasUnmatchedCredit)) root.append(h('p.note', null, t('housing.unmatchedHint')));
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
  const history = rentRecordSummary(ctx.S);
  if (history.missing.length) root.append(h('section.card', null, h('h2.section-h', null, t('rent.historyMissing')),
    h('p.note', null, t('rent.historyMissingHint')),
    h('div.people', null, tenants.filter(r => history.missing.some(x => x.residentId === r.id)).map(r => {
      const records = history.missing.filter(x => x.residentId === r.id);
      return h('a.person', { href: '#/person/' + encodeURIComponent(r.id) }, avatar(r), h('span.person-name', null, r.name),
        h('span.small.muted', null, t('rent.missingMonths', { n: records.length })), h('span.person-amt', null, t('rent.completeHistory') + ' ›'));
    }))));
  if (tenants.length) root.append(rentIncome(ctx, receipts));
  const unclassified = Object.values(ctx.S.data.payments).filter(p => !p.deleted && !isHousingPayment(p));
  if (unclassified.length) root.append(h('details.card', null, h('summary', null, t('rent.unclassified', { n: unclassified.length })),
    h('p.note', null, t('rent.unclassifiedHint')), unclassified.map(p => h('p.small', null, date(p.date), ' · ', money(p.amount), ' · ', p.note || '',
      h('button.link-btn', { type: 'button', onclick: () => { if (confirm(t('rent.classifyConfirm'))) ctx.put('payments', { ...p, purpose: 'rent' }); } }, t('rent.classify'))))));
}

function rentIncome(ctx, receipts) {
  const currentMonth = ctx.D.today.slice(0, 7), currentYear = Number(currentMonth.slice(0, 4));
  const dated = [...receipts.payments, ...receipts.unknownAmounts];
  const years = dated.map(p => Number(p.date.slice(0, 4))).concat(currentYear);
  const options = Array.from({ length: Math.max(...years) - Math.min(...years) + 1 }, (_, i) => Math.max(...years) - i);
  const annuals = options.map(year => ({ year, ...rentReceiptYear(receipts, year) }));
  const maximum = Math.max(1, ...annuals.flatMap(a => a.months.map(m => Math.abs(m.net))));
  let year = currentYear, selected = null, view = ctx.L.prefs.rentIncomeView === 'calendar' ? 'calendar' : 'list';
  const views = h('div.seg-tabs', { role: 'group', 'aria-label': t('income.view') }, ['list', 'calendar'].map(key =>
    h('button.seg-tab', { type: 'button', 'data-view': key, onclick: () => { view = key; ctx.setPref('rentIncomeView', key); draw(); } }, t('income.' + key))));
  const select = h('select', { 'aria-label': t('income.year'), onchange: () => { year = Number(select.value); selected = null; draw(); } },
    options.map(y => h('option', { value: y, selected: y === year }, t('income.yearLabel', { year: y }))));
  const total = h('span.small.muted.num'), rows = h('div.income-months');
  const controls = h('div.row.income-controls', null, select, h('span.sp'), total);
  const legend = h('div.income-legend', null,
    h('span', null, h('i.income-swatch', { 'aria-hidden': 'true' }), t('income.noRecord')),
    h('span', null, h('i.income-scale', { 'aria-hidden': 'true' }), t('income.scale')),
    h('span', null, h('i.income-swatch.refund', { 'aria-hidden': 'true' }), t('income.netRefund')),
    h('span', null, h('i.income-swatch.offset', { 'aria-hidden': 'true' }), t('income.offset')));
  const detail = h('div.income-detail', { id: 'rent-income-detail', hidden: true, 'aria-live': 'polite' });
  const transaction = p => h('div.income-transaction', null,
    h('div', null, h('a', { href: '#/person/' + encodeURIComponent(p.residentId) }, ctx.S.data.residents[p.residentId].name),
      h('div.small.muted', null, p.date ? date(p.date, 'iso') : t(p.dateUnavailable ? 'rent.dateUnavailable' : 'rent.receiptDatePending'),
        ' · ', t(p.amount < 0 ? 'rent.refund' : 'rent.receipt'), ' · ', p.method ? t('method.' + p.method) : t('rent.methodPending'))),
    h('span.num', null, Number.isFinite(p.amount) ? money(p.amount) : t('rent.amountMissing')));
  function monthButton(m, calendar = false) {
    const future = m.key > currentMonth && !m.payments.length;
    const label = future ? t('income.future') : m.incomplete ? t('rent.amountMissing') : !m.payments.length ? t('income.noRecord') :
      m.net === 0 ? t(m.received > 0 ? 'income.offset' : 'income.zeroRecorded') : m.net < 0 ? t('income.netRefund') : '';
    const value = future ? '—' : m.incomplete && !m.payments.some(p => Number.isFinite(p.amount)) ? '—' : money(m.net, { whole: calendar && Number.isInteger(m.net) });
    const level = m.net > maximum * 2 / 3 ? 100 : m.net > maximum / 3 ? 50 : 25;
    const color = m.net > 0 ? '.positive' + (level === 100 ? '.strong' : '') : m.net < 0 ? '.refund' : m.received > 0 ? '.offset' : '';
    const middle = calendar ? null : label ? h('span.income-month-note', null, label) : h('span.income-track', { 'aria-hidden': 'true' },
      h('span.income-bar', { style: { width: Math.abs(m.net) / maximum * 100 + '%' } }));
    const note = label && !future && (m.incomplete || (m.payments.length && m.net === 0)) ? h('span.income-tile-note', null, label) : null;
    return h('button.' + (calendar ? 'income-tile' + color : 'income-month') + (selected === m.key ? '.on' : ''), { type: 'button', disabled: future,
      style: calendar ? '--income-level:' + level + '%' : null,
      'aria-pressed': String(selected === m.key), 'aria-controls': 'rent-income-detail',
      'aria-label': month(m.key) + ' · ' + value + (label ? ' · ' + label : ''), onclick: () => {
        selected = m.key; year = Number(m.key.slice(0, 4)); draw(); rows.querySelector('.on').focus({ preventScroll: true }); detail.scrollIntoView({ block: 'nearest' });
      } }, h('span', null, month(m.key, 'short')), middle,
      h('span.income-amount.num', null, calendar && future ? label : value),
      calendar ? note : h('span.income-chevron', { 'aria-hidden': 'true' }, future ? '' : '›'));
  }
  function draw() {
    const annual = annuals.find(a => a.year === year), calendar = view === 'calendar';
    controls.hidden = calendar; legend.hidden = !calendar; select.value = year;
    for (const button of views.children) {
      const on = button.dataset.view === view;
      button.classList.toggle('on', on); button.setAttribute('aria-pressed', String(on));
    }
    total.textContent = t('income.annualTotal', { amount: annual.net });
    rows.replaceChildren(...(calendar ? annuals.map(a => h('section.income-year', { dataset: { year: a.year } },
      h('div.row.income-year-heading', null, h('h3', null, t('income.yearLabel', { year: a.year })), h('span.small.muted.num', null, t('income.annualTotal', { amount: a.net }))),
      h('div.income-calendar', null, a.months.map(m => monthButton(m, true))))) : annual.months.map(m => monthButton(m))));
    const m = annual.months.find(m => m.key === selected);
    detail.hidden = !m;
    if (calendar && m) rows.querySelector('[data-year="' + year + '"]').append(detail);
    else legend.after(detail);
    if (m) {
      const content = [h('div.row', null, h('h3', null, month(m.key)), h('span.sp'), h('span.num', null, t('income.netTotal', { amount: m.net })))];
      if (m.payments.length) content.push(h('p.small.muted', null, t('rent.receiptsBreakdown', { paid: m.received, amount: m.refunded })));
      if (m.incomplete) content.push(h('p.note', null, t('income.incompleteHint')));
      content.push(...(m.payments.length ? [...m.payments].sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id)).map(transaction) : [h('p.small.muted', null, t('income.emptyHint'))]));
      detail.replaceChildren(...content);
    }
  }
  const card = h('section.card.rent-income', null, h('div.row.income-heading', null, h('h2.section-h', null, t('income.title')), views),
    h('p.small.muted', null, t('income.subtitle')),
    controls, rows, legend, detail);
  if (receipts.undated.length) card.append(h('details.income-undated', null, h('summary', null, t('income.undated', { n: receipts.undated.length })),
    h('p.note', null, t('income.undatedHint')), receipts.undated.map(transaction)));
  card.append(h('p.note', null, t('income.note')));
  draw(); return card;
}
