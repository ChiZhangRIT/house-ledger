// 添加账单：选 PDF（可多选）/ 拖进窗口 → 在本机读出文字 → 认出是哪家 → 解析成草稿 → 逐张确认。
// 读不出来（扫描件、加密、不认识的公司）时可以粘贴文字再识别，或者手动录入。PDF 不上传、不保存。
import { h, openSheet, toast } from '../ui/dom.js';
import { t, period, money } from '../i18n.js';
import { providerColor } from '../ui/colors.js';
import { loadPdfjs, sha256 } from '../pdf/loader.js';
import { parseBillPdf, parseBillLines } from '../pdf/parse.js';
import { openBillForm, draftToBill, manualDraft, providerChoices } from './billForm.js';
import { dot } from './parts.js';

export function openAdd(ctx) {
  const fileIn = h('input', { type: 'file', accept: 'application/pdf,.pdf', multiple: true, hidden: true,
    onchange: e => { const files = [...e.target.files]; sheet.close(); if (files.length) addFiles(ctx, files); } });
  const sheet = openSheet({
    title: t('add.title'),
    body: h('div.add-options', null,
      h('button.add-opt.primary', { type: 'button', onclick: () => fileIn.click() },
        h('span.add-opt-icon', { 'aria-hidden': 'true' }, '📄'), h('span', null, h('b', null, t('add.pdf')), h('small', null, t('add.pdfSub')))),
      h('button.add-opt', { type: 'button', onclick: () => { sheet.close(); openPaste(ctx); } },
        h('span.add-opt-icon', { 'aria-hidden': 'true' }, '📋'), h('span', null, h('b', null, t('add.paste')), h('small', null, t('add.pasteSub')))),
      h('div.add-manual', null, h('b', null, t('add.manual')),
        h('div.chips', null, providerChoices(ctx).filter(p => p.active).map(p => h('button.chip', { type: 'button', onclick: () => { sheet.close(); openBillForm(ctx, { draft: manualDraft(ctx, p.id) }); } }, dot(providerColor(p)), p.name)))),
      h('p.note', null, '🔒 ' + t('privacy.pdf')),
      fileIn),
  });
}

/** 读一批文件；全部读完后按服务期从早到晚逐张确认（后一张能和刚存的前一张比较） */
export async function addFiles(ctx, files) {
  const pdfs = files.filter(f => /\.pdf$/i.test(f.name) || f.type === 'application/pdf');
  if (!pdfs.length) { toast(t('add.notPdf')); return; }
  const rows = pdfs.map(f => ({ file: f, status: 'wait', el: h('li.file-row.wait', null, h('span.file-name', null, f.name), h('span.file-status', null, t('add.waiting'))) }));
  const list = h('ul.file-list', null, rows.map(r => r.el));
  const actions = h('div.row');
  const sheet = openSheet({ title: t('add.reading'), body: h('div', null, list, actions, h('p.note', null, '🔒 ' + t('privacy.pdf'))) });
  let pdfjs;
  try { pdfjs = await loadPdfjs(); }
  catch (e) { list.replaceChildren(h('li.err', null, t('add.loadFail'))); return; }
  for (const r of rows) {
    setRow(r, 'busy', t('add.busy'));
    try {
      const buf = await r.file.arrayBuffer();
      const hash = await sha256(buf);
      const res = await parseBillPdf(pdfjs, new Uint8Array(buf));
      r.result = res;
      r.src = { method: 'pdf', file: r.file.name, size: r.file.size, sha256: hash };
      if (res.ok) setRow(r, 'ok', [t('add.recognized', { provider: providerName(ctx, res.draft.provider) }), ' · ', period(res.draft.periodStart, res.draft.periodEnd), ' · ', money(res.draft.total)]);
      else setRow(r, 'fail', t('add.fail.' + res.reason));
    } catch (e) {
      r.result = { ok: false, reason: e && e.name === 'PasswordException' ? 'password' : 'unreadable' };
      setRow(r, 'fail', t('add.fail.' + r.result.reason));
    }
    if (r.status === 'fail') r.el.append(h('span.file-actions', null,
      h('button.link-btn', { type: 'button', onclick: () => { sheet.close(); openPaste(ctx); } }, t('add.paste')),
      h('button.link-btn', { type: 'button', onclick: () => { sheet.close(); chooseManual(ctx, r.file.name); } }, t('add.manualShort'))));
  }
  const ok = rows.filter(r => r.status === 'ok').sort((a, b) => (a.result.draft.periodStart || '').localeCompare(b.result.draft.periodStart || ''));
  if (!ok.length) return;
  const start = () => { sheet.close(); runQueue(ctx, ok.map(r => draftToBill(ctx, r.result.draft, r.src))); };
  if (ok.length === rows.length) { setTimeout(start, ok.length === 1 ? 250 : 600); return; }
  actions.replaceChildren(h('button.btn.primary', { type: 'button', onclick: start }, t('add.confirmN', { n: ok.length })));
}

function runQueue(ctx, drafts, i = 0) {
  if (i >= drafts.length) return;
  openBillForm(ctx, { draft: drafts[i], queue: { i, n: drafts.length }, onDone: ({ saved, skipped }) => { if (saved || skipped) runQueue(ctx, drafts, i + 1); } });
}

function setRow(r, status, content) {
  r.status = status;
  r.el.className = 'file-row ' + status;
  r.el.querySelector('.file-status').replaceChildren(...[].concat(content));
}
const providerName = (ctx, key) => { const p = ctx.S.data.providers['p_' + key]; return p && !p.deleted ? p.name : key; };

/** 粘贴账单文字（比如从「预览」里复制，或者用 iPhone 的实况文本从照片里复制），走同一套解析 */
function openPaste(ctx) {
  const ta = h('textarea.paste', { rows: 10, placeholder: t('add.pastePh') });
  const err = h('p.err', { hidden: true });
  const sheet = openSheet({
    title: t('add.paste'), body: h('div', null, h('p.muted.small', null, t('add.pasteHelp')), ta, err),
    foot: [h('span.sp'), h('button.btn', { type: 'button', onclick: () => sheet.close() }, t('cancel')),
      h('button.btn.primary', { type: 'button', onclick: () => {
        const lines = ta.value.split(/\r?\n/).map(s => s.replace(/\t/g, '  ').trimEnd()).filter(Boolean);
        const res = parseBillLines(lines);
        if (!res.ok) { err.textContent = t('add.fail.' + res.reason); err.hidden = false; return; }
        sheet.close();
        openBillForm(ctx, { draft: draftToBill(ctx, res.draft, { method: 'paste' }) });
      } }, t('add.recognize'))],
  });
  setTimeout(() => ta.focus(), 50);
}

/** 识别失败后手动录入：按文件名猜一下是哪家 */
function chooseManual(ctx, fileName = '') {
  const n = fileName.toLowerCase();
  const guess = /pg.?e|pge/.test(n) ? 'p_pge' : /sunnyvale|water|utility/.test(n) ? 'p_sunnyvale' : /att|at&t/.test(n) ? 'p_att' : /xfinity|comcast/.test(n) ? 'p_xfinity' : null;
  if (guess) { const d = manualDraft(ctx, guess); d.source.file = fileName || null; openBillForm(ctx, { draft: d }); return; }
  openAdd(ctx);
}
