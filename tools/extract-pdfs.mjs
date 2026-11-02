// 把一个文件夹里的账单 PDF 全部解析一遍（和网页里用的是同一套解析器），给 migrate-numbers.mjs 补用量、分项、到期日。
// 用法：node tools/extract-pdfs.mjs <PDF 文件夹> <输出文件夹> [OCR 文字文件夹]
// - 读不出文字的扫描件（比如 2025 年以前的 PG&E 账单），先用 tools/ocr-pdf.swift 在本机 OCR，
//   把 <文件名>.pdf.txt 放在 OCR 文字文件夹里，这里会自动改用 OCR 的文字。
// - 输出 <输出文件夹>/<账单方>.json：[{ file, draft }]。里面有金额和账号后四位，是私人数据，请放在仓库外面。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [dir, outDir, ocrDir] = process.argv.slice(2);
if (!dir || !outDir) { console.error('usage: node tools/extract-pdfs.mjs <pdf-folder> <out-folder> [ocr-text-folder]'); process.exit(1); }
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pdfjs = await import(path.join(repo, 'vendor/pdfjs/pdf.min.mjs'));
pdfjs.GlobalWorkerOptions.workerSrc = path.join(repo, 'vendor/pdfjs/pdf.worker.min.mjs');
const { parseBillPdf, parseBillLines } = await import(path.join(repo, 'src/pdf/parse.js'));

const files = [];
(function walk(d) { for (const f of fs.readdirSync(d).sort()) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else if (/\.pdf$/i.test(f)) files.push(p); } })(dir);
const byProvider = {}, failed = [], needOcr = [];
for (const f of files) {
  let r = await parseBillPdf(pdfjs, fs.readFileSync(f));
  let source = 'pdf';
  if (!r.ok && r.reason === 'unreadable') {
    const txt = ocrDir && path.join(ocrDir, path.basename(f) + '.txt');
    if (txt && fs.existsSync(txt)) { r = parseBillLines(fs.readFileSync(txt, 'utf8').split(/\n/).filter(l => l !== '\f')); source = 'ocr'; }
    else needOcr.push(f);
  }
  if (r.ok) (byProvider[r.draft.provider] = byProvider[r.draft.provider] || []).push({ file: path.basename(f), source, draft: r.draft });
  else if (!needOcr.includes(f)) failed.push(`${path.basename(f)}: ${r.reason}`);
}
fs.mkdirSync(outDir, { recursive: true });
for (const [p, list] of Object.entries(byProvider)) fs.writeFileSync(path.join(outDir, p + '.json'), JSON.stringify(list, null, 1));
console.log(Object.entries(byProvider).map(([p, l]) => `${p} ${l.length}（OCR ${l.filter(x => x.source === 'ocr').length}）`).join('，'));
if (needOcr.length) console.log(`读不出文字、也没有 OCR 结果的 ${needOcr.length} 份：先运行 tools/ocr-pdf.swift\n  ` + needOcr.map(f => path.basename(f)).join('\n  '));
if (failed.length) console.log('没认出来的：\n  ' + failed.join('\n  '));
