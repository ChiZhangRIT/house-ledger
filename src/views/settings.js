// 设置：收款规则、提醒、账单方、同步、数据（导入 / 备份）、语言与外观、隐私说明
import { h, openSheet, copyText, download, toast } from '../ui/dom.js';
import { t, getLang, LANGS, period } from '../i18n.js';
import { normalizeState, mergeStates, live, canon } from '../core/store.js';
import { SyncError } from '../core/sync.js';
import { periodStart, periodRange, prevPeriod, nextPeriod } from '../core/ledger.js';
import { addDays } from '../core/dates.js';
import { SPLIT_CATEGORIES } from '../core/providers.js';
import { sourceNotes } from './notes.js';
import { batchDocuments } from './documents.js';
import { clearBillPdfs } from '../core/documents.js';
import { openDeleted } from './deleted.js';

export function render(root, ctx) {
  const S = ctx.S, set = (k, v) => ctx.quietly(() => ctx.setSetting(k, v));      // 不重画：免得吞掉下一下点击
  const putQuiet = rec => ctx.quietly(() => ctx.put('providers', rec));
  const cur = p => ctx.S.data.providers[p.id] || p;      // 同一行连续改两项：第二次要在最新的记录上改
  const L = ctx.D.ledger;

  // 收款规则
  const first = (ctx.D.residents.map(r => r.moveIn).filter(Boolean).sort()[0] || ctx.D.today).slice(0, 7);
  const keys = periodRange(prevPeriod(first), nextPeriod(nextPeriod(L.current))).reverse();
  root.append(section(t('set.rules'),
    field(t('set.property'), h('input', { value: S.settings.propertyName || '', onchange: e => set('propertyName', e.target.value.trim()) })),
    h('div.field-row', null,
      field(t('set.cycleDay'), h('input', { type: 'number', min: 1, max: 28, value: S.settings.rentCycleDay || 16, onchange: e => set('rentCycleDay', Math.min(28, Math.max(1, Number(e.target.value) || 16))) }), t('set.cycleDayHint')),
      field(t('set.grace'), h('input', { type: 'number', min: 0, max: 31, value: S.settings.graceDays ?? 3, onchange: e => set('graceDays', Math.max(0, Number(e.target.value) || 0)) }), t('set.graceHint'))),
    field(t('set.ledgerStart'), h('select', { onchange: e => set('ledgerStart', e.target.value || null) },
      h('option', { value: '', selected: !S.settings.ledgerStart }, t('set.ledgerNone')),
      keys.map(k => h('option', { value: k, selected: k === S.settings.ledgerStart }, t('period.m', { m: Number(k.slice(5)), y: k.slice(0, 4) }) + ' · ' + period(periodStart(k, L.cd), addDays(periodStart(nextPeriod(k), L.cd), -1))))), t('set.ledgerHint')),
    field(t('set.prorate'), h('select', { onchange: e => set('prorate', e.target.value) },
      ['daily', 'full'].map(v => h('option', { value: v, selected: (S.settings.prorate || 'daily') === v }, t('set.prorate.' + v)))))));

  // 账单方
  root.append(section(t('set.providers'),
    h('div.table-scroll', null, h('table.data-table.providers', null,
      h('thead', null, h('tr', null, h('th', null, t('set.provName')), h('th', null, t('bill.category')), h('th', null, t('set.convention')), h('th', null, t('set.autopay')), h('th', null, t('set.active')))),
      h('tbody', null, ctx.D.providerList.map(p => h('tr', null,
        h('td', null, h('input', { value: p.name, 'aria-label': t('set.provName'), onchange: e => e.target.value.trim() && putQuiet({ ...cur(p), name: e.target.value.trim() }) })),
        h('td', null, h('select', { 'aria-label': t('bill.category'), onchange: e => putQuiet({ ...cur(p), category: e.target.value }) }, SPLIT_CATEGORIES.map(c => h('option', { value: c, selected: p.category === c }, t('splitcat.' + c))))),
        h('td', null, h('select', { 'aria-label': t('set.convention'), onchange: e => putQuiet({ ...cur(p), periodConvention: e.target.value }) }, ['inclusive', 'shared'].map(c => h('option', { value: c, selected: (p.periodConvention || 'shared') === c }, t('conv.' + c))))),
        h('td', null, h('input', { type: 'checkbox', 'aria-label': t('set.autopay'), checked: !!p.autopay, onchange: e => putQuiet({ ...cur(p), autopay: e.target.checked }) })),
        h('td', null, h('input', { type: 'checkbox', 'aria-label': t('set.active'), checked: p.active !== false, onchange: e => putQuiet({ ...cur(p), active: e.target.checked }) }))))))),
    h('p.note', null, t('set.convHint')),
    h('button.link-btn', { type: 'button', onclick: () => addProvider(ctx) }, '＋ ' + t('set.addProvider'))));

  // 同步
  const s = ctx.L.sync;
  root.append(section(t('set.sync'),
    s ? [h('p', null, t('set.syncOn', { repo: s.repo })),
      s.err ? h('p.err', null, t('syncErr.' + s.err.code, s.err.vars)) : null,
      h('div.row', null,
        h('button.btn', { type: 'button', onclick: async () => { const r = await ctx.sync.now(); ctx.render(); if (r.ok) toast(ctx.L.sync && ctx.L.sync.offline ? t('sync.offline') : t('set.syncDone')); } }, t('set.syncNow')),
        h('button.btn', { type: 'button', onclick: async () => toast(await copyText(`house-ledger-sync:${s.repo}:${s.token}`) ? t('set.codeCopied') : t('set.codeFail'), { ms: 8000 }) }, t('set.copyCode')),
        h('button.btn.danger', { type: 'button', onclick: () => { if (confirm(t('set.stopConfirm'))) { ctx.sync.stop(); toast(t('set.stopped')); } } }, t('set.stopSync')))]
      : [h('p', null, t('set.syncOff')), h('button.btn.primary', { type: 'button', onclick: () => openSync(ctx) }, t('set.syncSetup'))]));

  // 数据
  const fileIn = h('input', { type: 'file', accept: '.json,application/json', hidden: true, onchange: e => { const f = e.target.files[0]; e.target.value = ''; if (f) importFile(ctx, f); } });
  root.append(section(t('set.data'),
    h('p.note', null, t('set.dataNote')),
    h('div.row', null,
      h('button.btn', { type: 'button', onclick: () => fileIn.click() }, t('set.import')),
      h('button.btn', { type: 'button', onclick: () => download(`house-ledger-backup-${ctx.D.today}.json`, JSON.stringify({ app: 'house-ledger', kind: 'backup', v: 1, createdAt: new Date().toISOString(), state: ctx.S })) }, t('set.export')),
      h('button.btn', { type: 'button', onclick: () => openDeleted(ctx) }, t('deleted.title')),
      h('button.btn.danger', { type: 'button', onclick: () => clearDevice(ctx) }, t('set.clear'))),
    fileIn, batchDocuments(ctx)));
  const notes = sourceNotes(S); if (notes) root.append(notes);

  // 语言与外观
  root.append(section(t('set.look'),
    h('div.field-row', null,
      field(t('set.lang'), h('select', { onchange: e => ctx.setLang(e.target.value) }, LANGS.map(l => h('option', { value: l, selected: l === getLang() }, l === 'en' ? 'English' : '简体中文')))),
      field(t('set.theme'), h('select', { onchange: e => ctx.setTheme(e.target.value) }, ['auto', 'light', 'dark'].map(v => h('option', { value: v, selected: (ctx.L.theme || 'auto') === v }, t('theme.' + v))))))));

  root.append(section(t('set.about'), h('ul.small', null, ['privacy.local', 'privacy.pdf', 'privacy.sync', 'privacy.home'].map(k => h('li', null, t(k)))), h('p.note', null, 'pdf.js © Mozilla (Apache-2.0)')));
}

const SETTING_LABEL = { propertyName: 'set.property', rentCycleDay: 'set.cycleDay', graceDays: 'set.grace', ledgerStart: 'set.ledgerStart', prorate: 'set.prorate', payInstructions: 'set.payInstructions', anomalyPct: 'set.anomalyPct', anomalyMin: 'set.anomalyMin', expectLateDays: 'set.expectLate' };
const fmtSetting = v => (v == null || v === '' ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));
const section = (title, ...kids) => h('section.card.settings-sec', null, h('h2.section-h', null, title), kids);
const field = (label, input, hint) => h('label.field', null, h('span.field-label', null, label), input, hint ? h('span.hint', null, hint) : null);

function addProvider(ctx) {
  const f = { name: '', category: 'internet', periodConvention: 'shared' };
  const sheet = openSheet({
    title: t('set.addProvider'),
    body: h('div.form', null,
      field(t('set.provName'), h('input', { oninput: e => { f.name = e.target.value; } })),
      field(t('bill.category'), h('select', { onchange: e => { f.category = e.target.value; } }, SPLIT_CATEGORIES.map(c => h('option', { value: c, selected: c === f.category }, t('splitcat.' + c))))),
      field(t('set.convention'), h('select', { onchange: e => { f.periodConvention = e.target.value; } }, ['shared', 'inclusive'].map(c => h('option', { value: c }, t('conv.' + c)))))),
    foot: [h('span.sp'), h('button.btn', { type: 'button', onclick: () => sheet.close() }, t('cancel')),
      h('button.btn.primary', { type: 'button', onclick: () => {
        if (!f.name.trim()) return;
        const slug = f.name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'other';
        let id = 'p_' + slug; for (let i = 2; ctx.S.data.providers[id] && !ctx.S.data.providers[id].deleted; i++) id = 'p_' + slug + '-' + i;
        ctx.put('providers', { id, name: f.name.trim(), category: f.category, periodConvention: f.periodConvention, parser: null, active: true });
        sheet.close();
      } }, t('save'))],
  });
}

/** 导入 Numbers 迁移文件或备份：逐条合并，较新的为准（app 里改过的内容不会被旧文件覆盖） */
export async function importFile(ctx, file) {
  if (file.size > 20 * 1024 * 1024) { toast(t('imp.tooBig'), { ms: 6000 }); return; }
  let d = null;
  try { d = JSON.parse(await file.text()); } catch (e) { d = null; }
  if (!d || d.app !== 'house-ledger' || !d.state) { toast(t('imp.bad'), { ms: 6000 }); return; }
  const st = normalizeState(d.state);
  const merged = mergeStates(ctx.S, st);
  const changedSettings = Object.keys(merged.settings).filter(k => canon(merged.settings[k]) !== canon(ctx.S.settings[k]));
  const n = c => Object.values(st.data[c] || {}).filter(x => !x.deleted).length;
  const sheet = openSheet({
    title: d.kind === 'backup' ? t('imp.backupH') : (d.kind === 'source-notes' ? t('notes.importTitle') : t('imp.importH')),
    body: h('div', null, h('p', null, t('imp.counts', { bills: n('bills'), residents: n('residents'), payments: n('payments'), rents: n('rents') })),
      st.settings.ledgerStart && !ctx.S.settings.ledgerStart ? h('p.note', null, t('imp.ledgerStart', { p: t('period.m', { m: Number(st.settings.ledgerStart.slice(5)), y: st.settings.ledgerStart.slice(0, 4) }) })) : null,
      changedSettings.length ? h('div.check.warn', null, h('span.check-icon', { 'aria-hidden': 'true' }, '⚠'),
        h('div', null, t('imp.settingsChange'), h('ul.small', null, changedSettings.map(k => h('li', null, (SETTING_LABEL[k] ? t(SETTING_LABEL[k]) : k) + t('p.colon') + fmtSetting(ctx.S.settings[k]) + ' → ' + fmtSetting(merged.settings[k])))))) : null,
      d.kind === 'source-notes' ? h('p', null, t('notes.importCount', { n: n('comments'), periods: n('servicePeriods') })) : null,
      h('p.note', null, t('imp.mergeNote')), ctx.L.sync ? h('p.note', null, t('imp.syncNote')) : null),
    foot: [h('span.sp'), h('button.btn', { type: 'button', onclick: () => sheet.close() }, t('cancel')),
      h('button.btn.primary', { type: 'button', onclick: () => { const before = canon(ctx.S); ctx.mergeIn(st); sheet.close(); toast(canon(ctx.S) === before ? t('imp.nothing') : t('imp.done')); ctx.nav('overview'); } }, t('imp.go'))],
  });
}

async function clearDevice(ctx) {
  if (!confirm(ctx.L.sync ? t('set.clearConfirmSync') : t('set.clearConfirm'))) return;
  try { await clearBillPdfs(); } catch (e) { toast(t('pdf.clearFail')); return; }
  localStorage.removeItem('hl.state');
  localStorage.removeItem('hl.local');
  location.reload();
}

/** 设置同步：私有仓库 + fine-grained 令牌（只给这个仓库的 Contents 读写）；或者粘贴别的设备的同步码 */
function openSync(ctx) {
  const repoIn = h('input', { placeholder: t('sync.repoPh'), autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
  const tokIn = h('input', { type: 'password', placeholder: 'github_pat_…', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
  const err = h('p.err', { hidden: true });
  for (const el of [repoIn, tokIn]) el.addEventListener('input', e => {
    const m = e.target.value.trim().match(/^house-ledger-sync:([\w.-]+\/[\w.-]+):(\S+)$/);
    if (m) { repoIn.value = m[1]; tokIn.value = m[2]; }
  });
  const btn = h('button.btn.primary', { type: 'button', onclick: async () => {
    const repo = repoIn.value.trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '').replace(/\/+$/, '');
    const token = tokIn.value.trim();
    const fail = m => { err.textContent = m; err.hidden = false; };
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return fail(t('sync.badRepo'));
    if (!token) return fail(t('sync.noToken'));
    if (/^(ghp|gho|ghu|ghs)_/.test(token)) return fail(t('sync.classicToken'));   // 经典令牌能动整个账号，不收
    err.hidden = true; btn.disabled = true; btn.textContent = t('sync.connecting');
    try {
      const full = await ctx.sync.checkRepo(repo, token);
      ctx.sync.connect({ repo: full, token, sha: null, etag: null, dirty: false, at: 0, err: null, offline: false });
      const r = await ctx.sync.now();
      if (!r.ok || (ctx.L.sync && ctx.L.sync.offline)) { const code = r.error ? r.error.code : 'net'; ctx.sync.stop(); throw new SyncError(code, r.error ? r.error.vars : {}); }
      sheet.close();
      toast(t('sync.connected'), { ms: 7000 });
      ctx.render();
    } catch (e) {
      fail(t('syncErr.' + (e instanceof SyncError ? e.code : 'unknown'), e.vars || {}));
    } finally { btn.disabled = false; btn.textContent = t('sync.connect'); }
  } }, t('sync.connect'));
  const steps = h('ol.steps.small');
  for (const k of ['sync.step1', 'sync.step2', 'sync.step3', 'sync.step4']) steps.append(h('li', null, t(k)));
  const sheet = openSheet({
    title: t('set.syncSetup'),
    body: h('div.form', null, h('p.muted.small', null, t('sync.intro')), h('p.small', null, t('sync.have')),
      h('details.small', null, h('summary', null, t('sync.stepsH')), steps, h('p', null, h('a', { href: 'https://github.com/settings/personal-access-tokens/new', target: '_blank', rel: 'noopener' }, t('sync.tokenLink')))),
      field(t('sync.repo'), repoIn), field(t('sync.token'), tokIn), err),
    foot: [h('span.sp'), h('button.btn', { type: 'button', onclick: () => sheet.close() }, t('cancel')), btn],
  });
}
