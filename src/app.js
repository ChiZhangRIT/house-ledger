// 合租账本：启动、数据、路由、同步。各页面在 views/ 里，计算在 core/ 里。
import { normalizeState, mergeStates, stamp, live, canon } from './core/store.js';
import { createSync } from './core/sync.js';
import { buildRentLedger } from './core/rent.js';
import { today } from './core/dates.js';
import { t, setLang, getLang, LANGS } from './i18n.js';
import { h, $, toast } from './ui/dom.js';
import * as bills from './views/bills.js';
import * as billDetail from './views/billDetail.js';
import * as tenants from './views/tenants.js';
import * as person from './views/person.js';
import * as settings from './views/settings.js';
import { openAdd, addFiles } from './views/add.js';

const KEY = 'hl.state', LKEY = 'hl.local';
const VIEWS = { bills, bill: billDetail, tenants, person, settings };
const NAV = [
  { id: 'bills', icon: '▥' }, { id: 'tenants', icon: '⌂' },
];
const DEVICE = /iPad/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) ? 'iPad'
  : /iPhone|iPod/.test(navigator.userAgent) ? 'iPhone' : /Mac/.test(navigator.platform) ? 'Mac' : 'Browser';

// ---------- 数据 ----------
const readJSON = k => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } };
let S = normalizeState(readJSON(KEY));
let L = { lang: null, theme: 'auto', sync: null, prefs: {}, ...(readJSON(LKEY) || {}) };
let editVersion = 0, cache = null, batching = 0, pending = false, silent = 0;

function saveState() {
  try { localStorage.setItem(KEY, JSON.stringify(S)); }
  catch (e) { toast(t('err.storage'), { ms: 8000 }); }
}
function saveLocal() { try { localStorage.setItem(LKEY, JSON.stringify(L)); } catch (e) { /* 本机设置存不下也不影响使用 */ } }

function changed() {
  editVersion++;
  cache = null;
  saveState();
  if (L.sync) { L.sync.dirty = true; saveLocal(); schedulePush(); }
  if (silent) renderSyncBadge();
  else if (batching) pending = true; else render();
}
/** 改数据但不重画页面（设置页的输入框：重画会吞掉下一下点击、收起键盘） */
function quietly(fn) { silent++; try { return fn(); } finally { silent--; } }
/** 一次改多条记录，只重画一次 */
function batch(fn) {
  batching++;
  try { return fn(); } finally { batching--; if (!batching && pending) { pending = false; render(); } }
}
function put(c, rec) {
  const prev = S.data[c][rec.id];
  const next = stamp(rec, prev);
  S.data[c][rec.id] = next;
  changed();
  return next;
}
function remove(c, id) {
  const prev = S.data[c][id];
  if (!prev || prev.deleted) return null;
  S.data[c][id] = stamp({ id, deleted: true }, prev);
  changed();
  return prev;
}
function setSetting(k, v) {
  if (canon(S.settings[k]) === canon(v)) return;
  if (v === undefined || v === null || v === '') delete S.settings[k]; else S.settings[k] = v;
  S.settingsAt[k] = Math.max(Date.now(), (S.settingsAt[k] || 0) + 1);
  changed();
}
/** 导入或恢复：逐条合并（较新的为准） */
function mergeIn(other) {
  S = mergeStates(S, normalizeState(other));
  changed();
}
function setPref(k, v) { L.prefs[k] = v; saveLocal(); }

// 算出来的东西：数据不变就不重算
function derived() {
  const todayIso = today();
  if (cache && cache.today === todayIso) return cache;     // 跨过午夜（比如开着过了 16 号）也要重算
  const providers = S.data.providers;
  const allBills = live(S, 'bills').sort((a, b) => (a.statementDate < b.statementDate ? 1 : a.statementDate > b.statementDate ? -1 : 0));
  const res = live(S, 'residents').sort((a, b) => (b.isOwner - a.isOwner) || (a.moveIn < b.moveIn ? -1 : 1));
  cache = {
    today: todayIso, providers, bills: allBills, residents: res,
    providerList: live(S, 'providers'),
    payments: live(S, 'payments').filter(p => p.purpose === 'rent').sort((a, b) => (a.date < b.date ? 1 : -1)),
  };
  cache.ledger = buildRentLedger(S, todayIso);
  /** 同一类别的账单（网费换过公司也算一类），对比用 */
  cache.sameCategory = (b) => { const c = (providers[b.providerId] || {}).category; return allBills.filter(x => (providers[x.providerId] || {}).category === c); };
  return cache;
}

// ---------- 路由 ----------
function route() {
  const dec = s => { try { return decodeURIComponent(s); } catch (e) { return s; } };   // 截断的链接（%E0）不要让整个 app 白屏
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(dec);
  const aliases = { overview: 'bills', analysis: 'bills', residents: 'tenants', collect: 'tenants' };
  const name = aliases[parts[0]] || (Object.prototype.hasOwnProperty.call(VIEWS, parts[0]) ? parts[0] : 'bills');
  return { name, params: parts.slice(1) };
}
const nav = (path) => { const target = '#/' + path; if (location.hash === target) render(); else location.hash = target; };

const ctx = {
  get S() { return S; }, get L() { return L; }, get D() { return derived(); },
  t, put, remove, batch, quietly, setSetting, setPref, mergeIn, nav, toast, render: () => render(),
  device: DEVICE, openAdd: (files) => (files ? addFiles(ctx, files) : openAdd(ctx)),
  sync: null, saveLocal, setLang: (l) => { L.lang = l; saveLocal(); setLang(l); renderShell(); render(); },
  setTheme: (th) => { L.theme = th; saveLocal(); applyTheme(); render(); },
  get editVersion() { return editVersion; },
};

// ---------- 外壳：侧边栏（大屏）/ 底部标签（手机） ----------
function renderShell() {
  document.documentElement.lang = getLang();
  document.title = t('app.name');
  document.body.dataset.drop = t('drop.hint');
  const tabsEl = document.getElementById('tabs'); if (tabsEl) tabsEl.setAttribute('aria-label', t('nav.label'));
  const side = $('#side'), tabs = $('#tabs');
  const r0 = route().name;
  const cur = r0 === 'bill' ? 'bills' : r0 === 'person' ? 'tenants' : r0;
  side.replaceChildren(
    h('div.brand', null, h('img', { src: 'icons/icon-180.png', alt: '', width: 32, height: 32 }),
      h('div', null, h('b', null, t('app.name')), S.settings.propertyName ? h('small', null, S.settings.propertyName) : null)),
    h('nav', { 'aria-label': t('nav.label') }, NAV.map(n => h('a.nav-item' + (cur === n.id ? '.on' : ''), { href: '#/' + n.id, 'aria-current': cur === n.id ? 'page' : null },
      h('span.nav-icon', { 'aria-hidden': 'true' }, n.icon), t('nav.' + n.id)))),
    h('div.side-foot', null, h('a.nav-item', { href: '#/settings' }, '⚙ ' + t('nav.settings')), h('div.sync-status', null, syncBadge())),
  );
  tabs.replaceChildren(...NAV.map(n => h('a.tab' + (cur === n.id ? '.on' : ''), { href: '#/' + n.id, 'aria-current': cur === n.id ? 'page' : null }, h('span.nav-icon', { 'aria-hidden': 'true' }, n.icon), h('span', null, t('nav.' + n.id)))));
}

function syncBadge() {
  const s = L.sync;
  let cls = 'off', text = t('sync.off');
  if (s) {
    if (s.err) { cls = 'err'; text = t('sync.error'); }
    else if (s.offline) { cls = 'wait'; text = t('sync.offline'); }
    else if (s.dirty) { cls = 'wait'; text = t('sync.pending'); }
    else { cls = 'ok'; text = s.at ? t('sync.ok', { time: new Date(s.at).toLocaleTimeString(getLang(), { hour: 'numeric', minute: '2-digit' }) }) : t('sync.ok0'); }
  }
  return h('a.sync-badge.' + cls, { href: '#/settings', title: s && s.err ? t('syncErr.' + s.err.code, s.err.vars) : '' }, h('span.dot', { 'aria-hidden': 'true' }), text);
}
function renderSyncBadge() {
  const foot = $('#side .sync-status'); if (foot) foot.replaceChildren(syncBadge());
  const top = $('#topSync'); if (top) top.replaceChildren(syncBadge());
}

function render() {
  const active = document.activeElement;
  const focusKey = active && active.dataset ? active.dataset.fid : null;     // 重画后把焦点放回同一个控件
  const { name, params } = route();
  renderShell();
  const main = $('#main');
  const sameView = main.dataset.view === name + '/' + params.join('/');
  const keep = sameView ? main.scrollTop : 0;
  main.dataset.view = name + '/' + params.join('/');
  main.replaceChildren();
  const top = h('div.topbar', null, h('h1', null, name === 'bill' ? t('nav.bills') : name === 'person' ? t('nav.tenants') : t('nav.' + name)),
    h('span.sp'), h('div', { id: 'topSync' }, syncBadge()),
    h('a.icon-btn.top-more', { href: '#/settings', 'aria-label': t('nav.settings') }, '⚙'));
  main.append(top);
  const body = h('div.view.view-' + name);
  main.append(body);
  try { VIEWS[name].render(body, ctx, params); }
  catch (e) {
    // 安全模式：数据有问题时也要能导出备份、停止同步、清空这台设备
    console.error(e);
    body.replaceChildren(h('section.card', null, h('p.err', null, t('err.render'), ' ', String(e && e.message || e)),
      h('p.note', null, t('err.safe')),
      h('div.row', null,
        h('button.btn', { type: 'button', onclick: () => { const a = h('a', { href: URL.createObjectURL(new Blob([JSON.stringify({ app: 'house-ledger', kind: 'backup', v: 1, createdAt: new Date().toISOString(), state: S })], { type: 'application/json' })), download: 'house-ledger-backup.json' }); document.body.append(a); a.click(); a.remove(); } }, t('set.export')),
        L.sync ? h('button.btn', { type: 'button', onclick: () => ctx.sync.stop() }, t('set.stopSync')) : null,
        h('button.btn.danger', { type: 'button', onclick: () => { if (confirm(t('set.clearConfirm'))) { localStorage.removeItem(KEY); location.reload(); } } }, t('set.clear')))));
  }
  main.scrollTop = keep;
  if (focusKey) { const el = document.querySelector(`[data-fid="${CSS.escape(focusKey)}"]`); if (el) el.focus({ preventScroll: true }); }
  else if (!sameView && !document.querySelector('dialog[open]') && main.contains(active) === false && active !== document.body) main.focus({ preventScroll: true });   // 换页后读屏、键盘从新页面开始
}

function applyTheme() {
  const th = L.theme === 'light' || L.theme === 'dark' ? L.theme : (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.documentElement.dataset.theme = th;
  const meta = $('meta[name="theme-color"]'); if (meta) meta.content = th === 'dark' ? '#141413' : '#f6f4ef';
}

// ---------- 同步 ----------
let pushTimer = null, lastSyncTry = 0;
const sync = createSync({
  getState: () => S,
  applyRemote: (merged) => { S = merged; cache = null; saveState(); render(); },
  getConfig: () => L.sync,
  saveConfig: (cfg) => { if (L.sync === cfg) { saveLocal(); renderSyncBadge(); } },
  editVersion: () => editVersion,
  device: DEVICE,
});
ctx.sync = {
  now: () => { lastSyncTry = Date.now(); return sync.syncNow(); },
  checkRepo: sync.checkRepo,
  connect: (cfg) => { L.sync = cfg; saveLocal(); },
  stop: () => { clearTimeout(pushTimer); L.sync = null; saveLocal(); render(); },
};
function schedulePush() { clearTimeout(pushTimer); pushTimer = setTimeout(() => ctx.sync.now(), 1500); }
const syncSoon = () => { if (L.sync && Date.now() - lastSyncTry > 5000) ctx.sync.now(); };
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') syncSoon();
  else if (L.sync && L.sync.dirty) ctx.sync.now();
});
window.addEventListener('focus', () => { syncSoon(); if (cache && cache.today !== today()) render(); });
window.addEventListener('online', () => { if (L.sync) ctx.sync.now(); });
setInterval(() => { if (document.visibilityState === 'visible') syncSoon(); }, 60000);

// ---------- 把 PDF 拖进窗口 ----------
let dragDepth = 0;
const hasFiles = e => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
window.addEventListener('dragenter', e => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; document.body.classList.add('dragging'); });
window.addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) document.body.classList.remove('dragging'); });
window.addEventListener('drop', e => {
  if (!hasFiles(e)) return;
  e.preventDefault(); dragDepth = 0; document.body.classList.remove('dragging');
  const files = [...e.dataTransfer.files];
  const json = files.find(f => /\.json$/i.test(f.name));
  if (json && !files.some(f => /\.pdf$/i.test(f.name))) { settings.importFile(ctx, json); return; }
  if (files.length) ctx.openAdd(files);
});
// ⌘N / Ctrl+N 添加账单
window.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'n' && !document.querySelector('dialog[open]')) { e.preventDefault(); ctx.openAdd(); }
});

// ---------- 启动 ----------
setLang(L.lang && LANGS.includes(L.lang) ? L.lang : 'zh-Hans');
applyTheme();
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (L.theme === 'auto') { applyTheme(); render(); } });
window.addEventListener('hashchange', render);
render();
if (L.sync) ctx.sync.now();
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
window.__hl = { get S() { return S; }, ctx };   // 方便在浏览器控制台里查看
