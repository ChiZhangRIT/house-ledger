// 当前房屋资料；App、账单、住户三组设置。App 设置第一行是语言（四个 App 一样：一行、系统下拉菜单、选了马上生效），
// 下面是同步、外观、数据、隐私与关于（版本号、新版本下载好了的提示）。
import { h, openSheet, copyText, download, toast, confirmDialog } from '../ui/dom.js';
import { t, getLang, LANGS, LANG_LABELS } from '../i18n.js';
import { normalizeState, mergeStates, live, canon } from '../core/store.js';
import { SyncError, syncCode, parseSyncCode, validTokenExp, tokenDaysLeft, tokenWarn } from '../core/sync.js';
import { SPLIT_CATEGORIES } from '../core/providers.js';
import { batchDocuments } from './documents.js';
import { clearBillPdfs } from '../core/documents.js';
import { openDeleted } from './deleted.js';

export function render(root, ctx) {
  const S = ctx.S, set = (k, v) => ctx.quietly(() => ctx.setSetting(k, v));      // 不重画：免得吞掉下一下点击
  const putQuiet = rec => ctx.quietly(() => ctx.put('providers', rec));
  const cur = p => ctx.S.data.providers[p.id] || p;      // 同一行连续改两项：第二次要在最新的记录上改
  root.append(h('section.card.settings-property', null, h('h2.section-h', null, t('set.currentProperty')),
    field(t('set.property'), h('input', { value: S.settings.propertyName || '', onchange: e => set('propertyName', e.target.value.trim()) })),
    h('p.note', null, t('set.propertyScope'))));
  const appSettings = group(t('set.appSettings'));
  // 语言那一行的标题中英文写在一起（set.lang：中文那一半跟着界面写简体 / 繁体），不管现在是哪种语言都找得到；
  // 每个选项用它自己的语言写，lang 属性让读屏按那种语言念。存在哪里（本机 hl.local）不变
  appSettings.append(h('section.card.settings-sec.settings-line', null, row(t('set.lang'),
    h('select', { 'aria-label': t('set.lang'), dataset: { fid: 'set-lang' }, onchange: e => ctx.setLang(e.target.value) },
      LANGS.map(l => h('option', { value: l, lang: l, selected: l === getLang() }, LANG_LABELS[l]))))));

  // 住户的默认房租规则
  const tenantSettings = group(t('set.tenantSettings'), section(t('set.rules'),
    h('p.note', null, t('rent.scheduleSettings')),
    h('div.field-row', null,
      field(t('set.grace'), h('input', { type: 'number', min: 0, max: 31, value: S.settings.graceDays ?? 3, onchange: e => set('graceDays', Math.max(0, Number(e.target.value) || 0)) }), t('set.graceHint')),
      field(t('set.prorate'), h('select', { onchange: e => set('prorate', e.target.value) },
        ['daily', 'full'].map(v => h('option', { value: v, selected: (S.settings.prorate || 'daily') === v }, t('set.prorate.' + v))))))));

  // 账单方
  const billSettings = group(t('set.billSettings'), section(t('set.providers'),
    h('div.table-scroll', null, h('table.data-table.providers', null,
      h('thead', null, h('tr', null, h('th', null, t('set.provName')), h('th', null, t('bill.category')), h('th', null, t('set.convention')), h('th', null, t('set.autopay')), h('th', null, t('set.active')))),
      h('tbody', null, ctx.D.providerList.map(p => h('tr', null,
        h('td', null, h('input', { value: p.name, 'aria-label': t('set.provName'), onchange: e => e.target.value.trim() && putQuiet({ ...cur(p), name: e.target.value.trim() }) })),
        h('td', null, h('select', { 'aria-label': t('bill.category'), onchange: e => putQuiet({ ...cur(p), category: e.target.value }) }, SPLIT_CATEGORIES.map(c => h('option', { value: c, selected: p.category === c }, t('splitcat.' + c))))),
        h('td', null, h('select', { 'aria-label': t('set.convention'), onchange: e => putQuiet({ ...cur(p), periodConvention: e.target.value }) }, ['inclusive', 'shared'].map(c => h('option', { value: c, selected: (p.periodConvention || 'shared') === c }, t('conv.' + c))))),
        h('td', null, h('input', { type: 'checkbox', 'aria-label': t('set.autopay'), checked: !!p.autopay, onchange: e => putQuiet({ ...cur(p), autopay: e.target.checked }) })),
        h('td', null, h('input', { type: 'checkbox', 'aria-label': t('set.active'), checked: p.active !== false, onchange: e => putQuiet({ ...cur(p), active: e.target.checked }) }))))))),
    h('p.note', null, t('set.convHint')),
    h('button.link-btn', { type: 'button', onclick: () => addProvider(ctx) }, '＋ ' + t('set.addProvider'))),
    section(t('set.documents'), batchDocuments(ctx)));

  // 同步
  const s = ctx.L.sync;
  appSettings.append(section(t('set.sync'),
    s ? [h('p', null, t('set.syncOn', { repo: s.repo })),
      s.err ? h('p.err', null, t('syncErr.' + s.err.code, s.err.vars)) : null,
      expiryLine(s, ctx.D.today),
      h('div.row', null,
        h('button.btn', { type: 'button', onclick: async () => { const r = await ctx.sync.now(); ctx.render(); if (r.ok) toast(ctx.L.sync && ctx.L.sync.offline ? t('sync.offline') : t('set.syncDone')); } }, t('set.syncNow')),
        // 到期日跟着同步码走：用同步码连上的设备也会提前提醒
        h('button.btn', { type: 'button', onclick: async () => { const c = ctx.L.sync || s; toast(await copyText(syncCode(c.repo, c.token, c.tokenExp)) ? t('set.codeCopied') : t('set.codeFail'), { ms: 8000 }); } }, t('set.copyCode')),
        h('button.btn', { type: 'button', onclick: () => openRenew(ctx) }, t('sync.renew')),
        h('button.btn.danger', { type: 'button', onclick: async () => {
          if (!(await confirmDialog({ message: t('set.stopConfirm'), confirmLabel: t('set.stopSync'), danger: true }))) return;
          ctx.sync.stop(); toast(t('set.stopped'));
        } }, t('set.stopSync'))),
      validTokenExp(s.tokenExp) ? null : expiryForm(ctx)]
      : [h('p', null, t('set.syncOff')), h('button.btn.primary', { type: 'button', onclick: () => openSync(ctx) }, t('set.syncSetup'))]));

  // 数据
  const fileIn = h('input', { type: 'file', accept: '.json,application/json', hidden: true, onchange: e => { const f = e.target.files[0]; e.target.value = ''; if (f) importFile(ctx, f); } });
  const dataSettings = h('details.card.settings-sec', null, h('summary', null, t('set.data')),
    h('p.note', null, t('set.dataNote')),
    h('div.row', null,
      h('button.btn', { type: 'button', onclick: () => fileIn.click() }, t('set.import')),
      h('button.btn', { type: 'button', onclick: () => download(`house-ledger-backup-${ctx.D.today}.json`, JSON.stringify({ app: 'house-ledger', kind: 'backup', v: 1, createdAt: new Date().toISOString(), state: ctx.S })) }, t('set.export')),
      h('button.btn', { type: 'button', onclick: () => openDeleted(ctx) }, t('deleted.title')),
      h('button.btn.danger', { type: 'button', onclick: () => clearDevice(ctx) }, t('set.clear'))),
    fileIn);

  // 外观
  appSettings.append(h('section.card.settings-sec.settings-line', null, row(t('set.theme'),
    h('select', { 'aria-label': t('set.theme'), dataset: { fid: 'set-theme' }, onchange: e => ctx.setTheme(e.target.value) }, ['auto', 'light', 'dark'].map(v => h('option', { value: v, selected: (ctx.L.theme || 'auto') === v }, t('theme.' + v)))))));

  // 隐私与关于：版本号和 sw.js 的缓存名一样（src/version.js）。新版本下载好了（app.js 在启动、切回来时检查）就展开说一声
  const updateReady = !!(ctx.updateReady && ctx.updateReady());
  appSettings.append(dataSettings,
    h('details.card.settings-sec', { open: updateReady }, h('summary', null, t('set.about')), h('ul.small', null, ['privacy.local', 'privacy.pdf', 'privacy.sync', 'privacy.home'].map(k => h('li', null, t(k)))), h('p.note', null, 'pdf.js © Mozilla (Apache-2.0)'),
      h('p.small.muted.settings-version', null, t('set.version', { v: ctx.build })),
      h('p.small.settings-update', { role: 'status', hidden: !updateReady }, t('set.updateReady', { app: t('app.name') }))));
  root.append(appSettings, billSettings, tenantSettings);
}

const SETTING_LABEL = { propertyName: 'set.property', rentCycleDay: 'set.cycleDay', graceDays: 'set.grace', ledgerStart: 'set.legacyLedger', prorate: 'set.prorate', payInstructions: 'set.payInstructions', anomalyPct: 'set.anomalyPct', anomalyMin: 'set.anomalyMin', expectLateDays: 'set.expectLate' };
const fmtSetting = v => (v == null || v === '' ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));
const group = (title, ...kids) => h('section.settings-group', null, h('h2.settings-group-title', null, title), kids);
const section = (title, ...kids) => h('section.card.settings-sec', null, h('h3.section-h', null, title), kids);
const field = (label, input, hint) => h('label.field', null, h('span.field-label', null, label), input, hint ? h('span.hint', null, hint) : null);
/** 一行：左边标题，右边控件（语言、外观） */
const row = (label, control) => h('label.settings-row', null, h('span.settings-row-label', null, label), control);
/** 令牌到期日的输入框：键盘只填了一半时 value 是空的，badInput 能看出来，不能当成没填 */
const dateInput = (value, attrs = {}) => h('input', { type: 'date', value: validTokenExp(value) ? value : '', ...attrs });
const badDate = input => !!(input.validity && input.validity.badInput) || (!!input.value && !validTokenExp(input.value));

/** 「令牌 YYYY-MM-DD 到期。」两周内到期、已经过期时后面接着说该换了（按日历日算）。同步状态标签（app.js）鼠标停上去也是这句 */
export function expiryText(exp, today) {
  if (!validTokenExp(exp)) return '';
  const days = tokenDaysLeft(exp, today);
  return t('sync.exp', { date: exp }) + (tokenWarn(exp, today) ? (getLang() === 'en' ? ' ' : '') + (days < 0 ? t('sync.expired') : t('sync.expSoon', { n: days })) : '');
}
/** 同步卡片里的那一行：该换了就用黄色 */
function expiryLine(s, today) {
  const text = expiryText(s.tokenExp, today);
  return text ? h('p.small' + (tokenWarn(s.tokenExp, today) ? '.sync-exp-warn' : '.muted'), null, text) : null;
}

/**
 * 连接时没填到期日：在同步卡片里补上（和 PickNest 一样，填好以后就不再显示；要改就「换令牌」时重新填）。
 * 只存在这台设备上（和令牌放在一起），不进备份、不同步。点「保存」才算：用键盘填日期时年份会先变成 0002、0020……
 */
function expiryForm(ctx) {
  const input = dateInput(null);
  const err = h('p.err', { hidden: true });
  const save = () => {
    const c = ctx.L.sync;
    if (!c) return;
    if (!input.value || badDate(input)) { err.textContent = t('sync.badDate'); err.hidden = false; return; }
    // 改的是同一个设置对象：正在跑的同步不受影响（这一轮结束时存的也是它）
    c.tokenExp = input.value;
    ctx.saveLocal();
    toast(t('sync.expSaved'));
    ctx.render();
  };
  return h('div.sync-exp-form', null,
    h('div.row.sync-exp-row', null, field(t('sync.expLabel'), input), h('button.btn', { type: 'button', onclick: save }, t('sync.saveExp'))),
    h('p.note', null, t('sync.expHint')), err);
}

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
      changedSettings.length ? h('div.check.warn', null, h('span.check-icon', { 'aria-hidden': 'true' }, '⚠'),
        h('div', null, t('imp.settingsChange'), h('ul.small', null, changedSettings.map(k => h('li', null, (SETTING_LABEL[k] ? t(SETTING_LABEL[k]) : k) + t('p.colon') + fmtSetting(ctx.S.settings[k]) + ' → ' + fmtSetting(merged.settings[k])))))) : null,
      d.kind === 'source-notes' ? h('p', null, t('notes.importCount', { n: n('comments'), periods: n('servicePeriods') })) : null,
      h('p.note', null, t('imp.mergeNote')), ctx.L.sync ? h('p.note', null, t('imp.syncNote')) : null),
    foot: [h('span.sp'), h('button.btn', { type: 'button', onclick: () => sheet.close() }, t('cancel')),
      h('button.btn.primary', { type: 'button', onclick: () => { const before = canon(ctx.S); ctx.mergeIn(st); sheet.close(); toast(canon(ctx.S) === before ? t('imp.nothing') : t('imp.done')); ctx.nav('overview'); } }, t('imp.go'))],
  });
}

async function clearDevice(ctx) {
  if (!(await confirmDialog({ message: ctx.L.sync ? t('set.clearConfirmSync') : t('set.clearConfirm'), confirmLabel: t('set.clear'), danger: true }))) return;
  try { await clearBillPdfs(); } catch (e) { toast(t('pdf.clearFail')); return; }
  localStorage.removeItem('hl.state');
  localStorage.removeItem('hl.local');
  location.reload();
}

/** 设置同步：私有仓库 + fine-grained 令牌（只给这个仓库的 Contents 读写）；或者粘贴别的设备的同步码 */
function openSync(ctx) {
  const repoIn = h('input', { placeholder: t('sync.repoPh'), autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
  const tokIn = h('input', { type: 'password', placeholder: 'github_pat_…', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
  const expIn = dateInput(null);
  const err = h('p.err', { hidden: true });
  // 粘贴别的设备复制来的同步码：拆开填好；新版的同步码带着令牌到期日，也填上（旧版的没有，照样认）
  for (const el of [repoIn, tokIn]) el.addEventListener('input', e => {
    const c = parseSyncCode(e.target.value);
    if (c) { repoIn.value = c.repo; tokIn.value = c.token; if (c.exp) expIn.value = c.exp; }
  });
  const btn = h('button.btn.primary', { type: 'button', onclick: async () => {
    const repo = repoIn.value.trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '').replace(/\/+$/, '');
    const token = tokIn.value.trim();
    const fail = m => { err.textContent = m; err.hidden = false; };
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return fail(t('sync.badRepo'));
    if (!token) return fail(t('sync.noToken'));
    if (/^(ghp|gho|ghu|ghs)_/.test(token)) return fail(t('sync.classicToken'));   // 经典令牌能动整个账号，不收
    if (badDate(expIn)) return fail(t('sync.badDate'));       // 填了一半、年份不对的日期：说一声，不悄悄当成没填
    err.hidden = true; btn.disabled = true; btn.textContent = t('sync.connecting');
    try {
      const full = await ctx.sync.checkRepo(repo, token);
      ctx.sync.connect({ repo: full, token, ...(expIn.value ? { tokenExp: expIn.value } : {}), sha: null, etag: null, dirty: false, at: 0, err: null, offline: false });
      const r = await ctx.sync.now();
      if (!r.ok || (ctx.L.sync && ctx.L.sync.offline)) { const code = r.error ? r.error.code : 'net'; ctx.sync.stop(); throw new SyncError(code, r.error ? r.error.vars : {}); }
      sheet.close();
      toast(t('sync.connected'), { ms: 7000 });
      ctx.render();
    } catch (e) {
      const code = e instanceof SyncError ? e.code : 'unknown';
      // 还没连上，页面上没有「换令牌」：令牌不对就说重新粘贴
      fail(code === 'auth' ? t('syncErr.authNew') : t('syncErr.' + code, e.vars || {}));
    } finally { btn.disabled = false; btn.textContent = t('sync.connect'); }
  } }, t('sync.connect'));
  const tokenSteps = h('ul.steps');
  for (let n = 3; n <= 8; n++) tokenSteps.append(h('li', null, t('sync.step' + n)));
  const steps = h('ol.steps.small', null,
    h('li', null, t('sync.step1')),
    h('li', null, t('sync.step2'),
      h('p', null, h('a', { href: 'https://github.com/settings/personal-access-tokens/new', target: '_blank', rel: 'noopener' }, t('sync.tokenLink'))),
      h('details', null, h('summary', null, t('sync.tokenStepsH')), h('p', null, t('sync.tokenPath')), tokenSteps,
        h('p', null, t('sync.tokenExpiry')), h('p', null, h('a', { href: 'https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens#creating-a-fine-grained-personal-access-token', target: '_blank', rel: 'noopener' }, t('sync.tokenDocs'))))),
    h('li', null, t('sync.step9')));
  const sheet = openSheet({
    title: t('set.syncSetup'),
    body: h('div.form', null, h('p.muted.small', null, t('sync.intro')), h('p.small', null, t('sync.have')),
      h('details.small', null, h('summary', null, t('sync.stepsH')), steps),
      field(t('sync.repo'), repoIn), field(t('sync.token'), tokIn), field(t('sync.expLabel'), expIn, t('sync.expHint')), err),
    foot: [h('span.sp'), h('button.btn', { type: 'button', onclick: () => sheet.close() }, t('cancel')), btn],
  });
}

/**
 * 换令牌：令牌快到期或者被撤销了，不用停止同步。也可以粘贴别的设备换好以后复制的同步码。
 * 先确认新令牌能读写这个仓库、仓库是私有的，再换上、马上同步一次；没成功就换回原来的设置（这期间又改过的话记着有没传的）。
 * 新令牌的到期日和旧的无关：没填就清掉
 */
function openRenew(ctx) {
  if (!ctx.L.sync) return;
  let repo = ctx.L.sync.repo;
  const repoLine = h('p.small', null, t('set.syncOn', { repo }));
  const tokIn = h('input', { type: 'password', placeholder: 'github_pat_…', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
  const expIn = dateInput(null);
  const err = h('p.err', { hidden: true });
  tokIn.addEventListener('input', () => {
    const c = parseSyncCode(tokIn.value);
    if (!c) return;
    repo = c.repo; tokIn.value = c.token; if (c.exp) expIn.value = c.exp;
    repoLine.textContent = t('set.syncOn', { repo });
  });
  const btn = h('button.btn.primary', { type: 'button', onclick: async () => {
    const token = tokIn.value.trim();
    const fail = m => { err.textContent = m; err.hidden = false; };
    if (!token) return fail(t('sync.noToken'));
    if (/^(ghp|gho|ghu|ghs)_/.test(token)) return fail(t('sync.classicToken'));
    if (badDate(expIn)) return fail(t('sync.badDate'));
    err.hidden = true; btn.disabled = true; btn.textContent = t('sync.connecting');
    const v0 = ctx.editVersion;
    try {
      const full = await ctx.sync.checkRepo(repo, token);
      const prev = ctx.L.sync;
      if (!prev) { sheet.close(); return; }          // 这期间在别处停止了同步
      // 同一个仓库：云端版本号留着，不用重新下载一遍；换了仓库就当第一次同步
      const next = { ...prev, repo: full, token, err: null, offline: false, ...(full === prev.repo ? {} : { sha: null, etag: null, dirty: true }) };
      if (expIn.value) next.tokenExp = expIn.value; else delete next.tokenExp;
      ctx.sync.connect(next);
      const r = await ctx.sync.now();
      if (!r.ok || (ctx.L.sync && ctx.L.sync.offline)) {
        if (ctx.L.sync === next) { if (ctx.editVersion !== v0) prev.dirty = true; ctx.sync.connect(prev); }
        throw new SyncError(r.error ? r.error.code : 'net', r.error ? r.error.vars : {});
      }
      sheet.close();
      toast(t('sync.renewed'), { ms: 7000 });
      ctx.render();
    } catch (e) {
      const code = e instanceof SyncError ? e.code : 'unknown';
      fail(code === 'auth' ? t('syncErr.authNew') : t('syncErr.' + code, e.vars || {}));
    } finally { btn.disabled = false; btn.textContent = t('save'); }
  } }, t('save'));
  const sheet = openSheet({
    title: t('sync.renew'),
    body: h('div.form', null, repoLine, h('p.small', null, t('sync.renewHelp')),
      h('p.small', null, h('a', { href: 'https://github.com/settings/personal-access-tokens/new', target: '_blank', rel: 'noopener' }, t('sync.tokenLink'))),
      field(t('sync.token'), tokIn), field(t('sync.expLabel'), expIn, t('sync.expHint')), err),
    foot: [h('span.sp'), h('button.btn', { type: 'button', onclick: () => sheet.close() }, t('cancel')), btn],
  });
}
