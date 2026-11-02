// 把 PDF 里的文字按行取出来：网页里和电脑上的导入脚本共用。
// pdfjs 由调用方传进来（网页用 vendor/pdfjs，Node 用 pdfjs-dist），这里不关心从哪来。

const Y_TOLERANCE = 2.5;   // 同一行文字的基线高度差（PDF 单位）

/**
 * @param {object} pdfjs  pdf.js 的模块对象（有 getDocument）
 * @param {ArrayBuffer|Uint8Array} data  PDF 文件内容
 * @returns {Promise<{pages: string[][], text: string}>} 每页的文字行，以及全部文字（行之间用换行）
 */
export async function pdfLines(pdfjs, data) {
  // Node 的 Buffer 也是 Uint8Array 的子类，但 pdf.js 不收，统一复制成普通的 Uint8Array
  const bytes = data instanceof Uint8Array && data.constructor === Uint8Array ? data : new Uint8Array(data);
  const task = pdfjs.getDocument({ data: bytes, isEvalSupported: false, disableFontFace: true, verbosity: 0 });   // 0 = 只报错误，不刷字体警告
  const doc = await task.promise;
  const pages = [];
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      pages.push(groupLines(content.items));
      page.cleanup();
    }
  } finally {
    await task.destroy();
  }
  return { pages, text: pages.map(lines => lines.join('\n')).join('\n\f\n') };
}

// 按基线高度把文字块分成行，行内按横坐标排序；相距较远的块之间用两个空格隔开，方便按列解析
export function groupLines(items) {
  const rows = [];
  for (const it of items) {
    const s = it.str;
    if (!s || !s.trim()) continue;
    const x = it.transform[4], y = it.transform[5], w = it.width || 0;
    // 归到基线最近的那一行（不是第一个在容差内的行）：左右两栏行距不同时，金额不会跑到别的行
    let row = null, best = Infinity;
    for (const r of rows) { const d = Math.abs(r.y - y); if (d <= Y_TOLERANCE && d < best) { best = d; row = r; } }
    if (!row) { row = { y, parts: [] }; rows.push(row); }
    row.parts.push({ x, w, s });
  }
  rows.sort((a, b) => b.y - a.y);          // PDF 坐标 y 向上增大：从上到下
  return rows.map(r => {
    r.parts.sort((a, b) => a.x - b.x);
    let line = '', end = null;
    for (const p of r.parts) {
      if (end != null) line += p.x - end > 8 ? '  ' : (p.x - end > 0.8 ? ' ' : '');
      line += p.s;
      end = p.x + p.w;
    }
    return line.replace(/\s+$/, '');
  });
}
