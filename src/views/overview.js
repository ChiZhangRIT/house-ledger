// 本期（首页）：本期该收多少、谁没交、有什么要处理、最近的账单比平时高还是低。
import { h } from '../ui/dom.js';
import { t, money, month, date, period, pct } from '../i18n.js';
import { columnChart } from '../ui/charts.js';
import { CAT_COLOR, providerColor } from '../ui/colors.js';
import { CATEGORIES, billStats, compareBill } from '../core/analytics.js';
import { dayNumber, addDays } from '../core/dates.js';
import { nextPeriod, prevPeriod } from '../core/ledger.js';
import { billRow, changeTag, dot, avatar, providerOf, statusChip } from './parts.js';

const ICON = { critical: '!', warn: '⚠', info: 'i' };

export function render(root, ctx) {
  const D = ctx.D, L = D.ledger;
  if (!D.bills.length && !D.residents.length) { root.append(welcome(ctx)); return; }

  // ① 期次 + ② 收款卡
  const key = ctx.L.prefs.ovPeriod && ctx.L.prefs.ovPeriod <= L.current ? ctx.L.prefs.ovPeriod : L.current;
  const P = L.period(key);
  const setKey = k => { ctx.setPref('ovPeriod', k === L.current ? null : k); ctx.render(); };
  const outstanding = P.left;
  const advanced = Object.values(L.people).reduce((a, p) => a + p.billOutstanding, 0);
  root.append(h('div.period-head', null,
    h('button.icon-btn', { type: 'button', 'aria-label': t('period.prev'), onclick: () => setKey(prevPeriod(key)) }, '‹'),
    h('h2', null, periodTitle(key, P)),
    h('button.icon-btn', { type: 'button', 'aria-label': t('period.next'), disabled: key >= L.current, onclick: () => setKey(nextPeriod(key)) }, '›'),
    key !== L.current ? h('button.link-btn', { type: 'button', onclick: () => setKey(L.current) }, t('period.current')) : null));
  const startKey = ctx.S.settings.ledgerStart;
  root.append(h('div.home-top', null,
    h('a.card.collect-card', { href: '#/collect/' + key },
      !startKey ? h('p.muted', null, t('home.noLedger')) : key < startKey ? [h('div.stat-label', null, t('home.toCollect')), h('p.muted', null, t('home.beforeLedger', { p: t('period.m', { m: Number(startKey.slice(5)), y: startKey.slice(0, 4) }) }))] : [
        h('div.stat-label', null, t('home.toCollect')),
        h('div.big-num.num', null, money(outstanding)),
        progress(P.C, P.E),
        h('div.small', null, t('home.collected', { paid: P.C, total: P.E, pct: P.E > 0 ? pct(P.C / P.E, { sign: false }) : '—' })),
        h('div.collect-lines.small.muted', null,
          h('span', null, t('home.rentLine', { total: P.rentE, paid: P.rentC })),
          h('span', null, t('home.billLine', { total: P.billE, paid: P.billC }))),
        advanced > 0.005 ? h('div.small.muted', null, t('home.advanced', { amount: advanced })) : null]),
    alertsBox(ctx)));

  // ④ 谁欠多少
  const people = D.residents.filter(r => !r.isOwner && L.people[r.id] && (!r.moveOut || r.moveOut > D.today || Math.abs(L.people[r.id].balance) > 0.005));
  if (people.length) {
    root.append(h('section.card', null, h('h2.section-h', null, t('home.whoOwes'), h('a.more', { href: '#/collect' }, t('nav.collect') + ' ›')),
      h('div.people', null, people.map(r => {
        const p = L.people[r.id];
        return h('a.person', { href: '#/person/' + encodeURIComponent(r.id) }, avatar(r),
          h('span.person-name', null, r.name, r.moveOut && r.moveOut <= D.today ? h('small.muted', null, ' · ' + t('res.movedOut')) : null,
            p.lastPayment ? h('small.muted.block', null, t('home.lastPay', { date: date(p.lastPayment.date, 'short'), method: t('method.' + (p.lastPayment.method || 'other')), amount: p.lastPayment.amount })) : null),
          personStatus(p));
      }))));
  }

  // ⑤ 各类最新账单
  const cats = ['energy', 'water', 'internet'];
  const latest = cats.map(c => D.bills.find(b => (D.providers[b.providerId] || {}).category === c)).filter(Boolean);
  if (latest.length) root.append(h('section.latest', null, h('h2.section-h', null, t('ov.latest')), h('div.latest-grid', null, latest.map(b => latestCard(b, ctx)))));

  // ⑥ 近 13 个月
  const m = D.monthly;
  if (m.months.length) {
    const from = Math.max(0, m.months.length - 13), months = m.months.slice(from);
    const chart = h('section.card.chart-card');
    root.append(chart);
    columnChart(chart, {
      title: t('ov.chartTitle'), tableLabel: t('viz.table'), totalLabel: t('viz.total'), xName: t('viz.month'),
      labels: months.map(k => month(k, 'axis')), longLabels: months.map((k, i) => month(k) + (m.complete[from + i] ? '' : ' · ' + t('viz.partial'))),
      series: CATEGORIES.map(c => ({ key: c, name: t('cat.' + c), color: CAT_COLOR[c], values: m.byCat[c].slice(from) })),
      partial: m.complete.slice(from).map(x => !x), stacked: true, format: v => money(v), tickFormat: v => money(v, { whole: true }), height: 220,
      onSelect: () => ctx.nav('analysis'),
    });
    chart.append(h('p.note', null, t('ov.chartNote')));
  }

  // ⑦ 最近账单
  root.append(h('section.card', null, h('h2.section-h', null, t('ov.recent'), h('a.more', { href: '#/bills' }, t('ov.allBills') + ' ›')),
    h('div.bill-list', null, D.bills.slice(0, 5).map(b => billRow(b, ctx)))));
}

export const periodTitle = (key, P) => t('period.title', { month: month(key), range: period(P.start, addDays(P.end, -1)) });

function progress(paid, total) {
  const f = total > 0 ? Math.max(0, Math.min(1, paid / total)) : 0;
  return h('div.progress', { role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(f * 100)) }, h('span', { style: { width: (f * 100).toFixed(1) + '%' } }));
}

/** 一个人的状态：逾期 / 待收 / 已结清 / 预付 */
export function personStatus(p) {
  if (p.overdue > 0.005) return statusChip('critical', t('st.overdue', { amount: p.overdue, days: p.overdueDays }));
  if (p.outstanding > 0.005) return statusChip('warning', t('st.due', { amount: p.outstanding }));
  if (p.credit > 0.005) return statusChip('credit', t('st.credit', { amount: p.credit }));
  return statusChip('good', t('st.settled'));
}

function alertsBox(ctx) {
  const all = ctx.D.alerts;
  if (!all.length) return h('section.card.alerts-card', null, h('h2.section-h', null, t('ov.alerts')), h('p.muted', null, '✓ ' + t('home.nothing')));
  const max = ctx.L.prefs.allAlerts ? all.length : 5;
  return h('section.card.alerts-card', { 'aria-label': t('ov.alerts') }, h('h2.section-h', null, t('ov.alerts')),
    all.slice(0, max).map(a => h('div.alert.' + a.level, null,
      h('button.alert-main', { type: 'button', onclick: () => (a.link === 'add' ? ctx.openAdd() : ctx.nav(a.link)) },
        h('span.alert-icon', { 'aria-hidden': 'true' }, ICON[a.level]),
        h('span.alert-text', null, t('alert.' + a.code, a.vars)),
        h('span.alert-go', { 'aria-hidden': 'true' }, '›')),
      a.key ? h('button.alert-dismiss', { type: 'button', title: t('alert.dismiss'), 'aria-label': t('alert.dismiss'),
        onclick: () => ctx.put('dismissals', { id: 'dis_' + a.key, key: a.key }) }, '✕') : null)),
    all.length > 5 ? h('button.link-btn', { type: 'button', onclick: () => { ctx.setPref('allAlerts', !ctx.L.prefs.allAlerts); ctx.render(); } },
      ctx.L.prefs.allAlerts ? t('ov.fewerAlerts') : t('ov.allAlerts', { n: all.length })) : null);
}

function latestCard(b, ctx) {
  const p = providerOf(ctx, b), st = billStats(b);
  const c = compareBill(b, ctx.D.sameCategory(b));
  return h('a.latest-card', { href: '#/bill/' + encodeURIComponent(b.id) },
    h('div.latest-head', null, dot(providerColor(p)), h('b', null, t('splitcat.' + p.category)), h('span.muted.small', null, ' · ' + p.name)),
    h('div.latest-amt.num', null, money(b.total)),
    h('div.muted.small', null, period(b.periodStart, b.periodEnd), ' · ', t('bill.days', { n: st.days })),
    h('div.small', null, st.perDay != null ? t('bill.perDay', { amount: st.perDay }) : '', ' ',
      c.lastYear ? changeTag(c.lastYear.perDayChange, { threshold: (Number(ctx.S.settings.anomalyPct) || 40) / 100, label: t('cmp.yoyShort') }) : null));
}

function welcome(ctx) {
  return h('section.card.welcome', null,
    h('h2', null, t('ov.welcomeH')),
    h('p', null, t('ov.welcomeP')),
    h('ol.steps', null,
      h('li', null, h('a', { href: '#/settings' }, t('ov.step1'))),
      h('li', null, h('a', { href: '#/settings' }, t('ov.step2'))),
      h('li', null, h('button.link-btn', { type: 'button', onclick: () => ctx.openAdd() }, t('ov.step3')))),
    h('p.note', null, '🔒 ' + t('privacy.local')));
}

/** 按以往的出账间隔推算每家下一张账单大概哪天出 */
export function nextBills(D) {
  const out = [];
  for (const p of D.providerList) {
    if (p.active === false) continue;
    const list = D.bills.filter(b => b.providerId === p.id).map(b => b.statementDate).sort();
    if (list.length < 2) continue;
    const gaps = list.slice(-7).map((d, i, a) => (i ? dayNumber(d) - dayNumber(a[i - 1]) : null)).filter(x => x != null).sort((a, b) => a - b);
    out.push({ provider: p, expected: addDays(list[list.length - 1], gaps[Math.floor(gaps.length / 2)]) });
  }
  return out.sort((a, b) => (a.expected < b.expected ? -1 : 1));
}
