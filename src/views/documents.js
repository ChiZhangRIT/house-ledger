import { h, openSheet, toast, download } from '../ui/dom.js';
import { t } from '../i18n.js';
import { loadPdfjs } from '../pdf/loader.js';
import { getBillPdf, readPdf, saveBillPdf, matchingBills } from '../core/documents.js';

export function billDocument(bill) {
  const row = h('div.bill-document'), content = h('div');
  const input = h('input', { type: 'file', accept: '.pdf,application/pdf', hidden: true, onchange: async () => {
    const file = input.files[0]; input.value = '';
    if (!file) return;
    try {
      const pdf = await readPdf(file);
      if (bill.source?.sha256 && pdf.sha256 !== bill.source.sha256) { toast(t('pdf.hashMismatch')); return; }
      await saveBillPdf(bill.id, pdf);
      refresh();
    } catch (e) { toast(t(e.message === 'not-pdf' ? 'pdf.invalid' : 'pdf.saveFail'), { ms: 8000 }); }
  } });
  async function refresh() {
    try {
      const pdf = await getBillPdf(bill.id);
      content.replaceChildren(h('div.row', null,
        pdf ? h('button.btn', { type: 'button', onclick: () => openPdf(pdf) }, t('pdf.open')) : null,
        h('button.link-btn', { type: 'button', onclick: () => input.click() }, t(pdf ? 'pdf.replace' : 'pdf.link')),
        h('span.small.muted', null, pdf?.name || bill.source?.file || t('pdf.notLinked'))),
      h('p.note', null, t('pdf.local')));
    } catch (e) { content.replaceChildren(h('p.note', null, t('pdf.unavailable'))); }
  }
  row.append(content, input); refresh();
  return row;
}

export function batchDocuments(ctx) {
  const status = h('p.note', { role: 'status' }, t('pdf.batchHelp'));
  const input = h('input', { type: 'file', accept: '.pdf,application/pdf', multiple: true, hidden: true, onchange: async () => {
    const files = [...input.files]; input.value = '';
    if (!files.length) return;
    button.disabled = true;
    let linked = 0, skipped = 0, failed = 0;
    for (let i = 0; i < files.length; i++) {
      status.textContent = t('pdf.progress', { n: i + 1, total: files.length });
      try {
        const pdf = await readPdf(files[i]), matches = matchingBills(pdf, ctx.D.bills);
        if (matches.length !== 1) { skipped++; continue; }
        const existing = await getBillPdf(matches[0].id);
        if (existing && existing.sha256 !== pdf.sha256) { skipped++; continue; }
        await saveBillPdf(matches[0].id, pdf); linked++;
      } catch (e) { failed++; }
    }
    status.textContent = t('pdf.batchDone', { linked, skipped, failed });
    button.disabled = false;
  } });
  const button = h('button.btn', { type: 'button', onclick: () => input.click() }, t('pdf.batch'));
  return h('div.pdf-batch', null, button, status, h('p.note', null, t('pdf.local')), input);
}

async function openPdf(file) {
  const pages = h('div.pdf-pages', null, t('pdf.loading')), position = h('span.small');
  let pdf, task, pageNo = 1, closed = false;
  const previous = h('button.btn', { type: 'button', disabled: true, onclick: () => render(pageNo - 1) }, t('pdf.previous'));
  const next = h('button.btn', { type: 'button', disabled: true, onclick: () => render(pageNo + 1) }, t('pdf.next'));
  const sheet = openSheet({ title: file.name, wide: true, body: pages, closeLabel: t('pdf.close'),
    foot: [previous, position, next, h('span.sp'), h('button.btn', { type: 'button', onclick: () => download(file.name, file.blob, 'application/pdf') }, t('pdf.download'))],
    onClose: () => { closed = true; if (task) task.destroy(); } });
  async function render(n) {
    previous.disabled = next.disabled = true;
    try {
      const page = await pdf.getPage(n);
      const scale = Math.min(900, pages.clientWidth || 900) / page.getViewport({ scale: 1 }).width;
      const ratio = Math.min(window.devicePixelRatio || 1, 2), viewport = page.getViewport({ scale });
      const canvas = h('canvas', { 'aria-label': t('pdf.page', { n, total: pdf.numPages }) });
      canvas.width = Math.ceil(viewport.width * ratio); canvas.height = Math.ceil(viewport.height * ratio);
      await page.render({ canvasContext: canvas.getContext('2d'), viewport, transform: [ratio, 0, 0, ratio, 0, 0] }).promise;
      if (closed) return;
      pages.replaceChildren(canvas); sheet.body.scrollTop = 0;
      pageNo = n; position.textContent = t('pdf.page', { n, total: pdf.numPages });
      previous.disabled = n === 1; next.disabled = n === pdf.numPages;
    } catch (e) { if (!closed) pages.replaceChildren(h('p.err', null, t('pdf.readFail'))); }
  }
  try {
    const pdfjs = await loadPdfjs();
    const data = new Uint8Array(await file.blob.arrayBuffer());
    if (closed) return;
    task = pdfjs.getDocument({ data, isEvalSupported: false, verbosity: 0 });
    pdf = await task.promise;
    if (closed) return;
    await render(1);
  } catch (e) { if (!closed) pages.replaceChildren(h('p.err', null, t('pdf.readFail'))); }
}
