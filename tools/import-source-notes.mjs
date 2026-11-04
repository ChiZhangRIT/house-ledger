// 补导原表批注和 PDF 分项服务期；不包含账单/住户/付款，绝不覆盖已整理的历史金额。
// node tools/import-source-notes.mjs <dump.json> <已有导入或备份.json> <输出.private.json> [PDF解析目录]
import fs from 'node:fs';
import path from 'node:path';
import { notesImport } from '../src/core/sourceNotes.js';
import { normalizeState, live } from '../src/core/store.js';

const [dumpPath, statePath, outPath, pdfDir] = process.argv.slice(2);
if (!outPath) throw new Error('需要 dump、已有账本和输出文件路径');
const original = normalizeState(JSON.parse(fs.readFileSync(statePath)).state);
const patch = notesImport(JSON.parse(fs.readFileSync(dumpPath)), original);
if (pdfDir) for (const file of fs.readdirSync(pdfDir).filter(f => f.endsWith('.json'))) {
  for (const entry of JSON.parse(fs.readFileSync(path.join(pdfDir, file)))) {
    const bill = live(original, 'bills').find(b => b.source.file === entry.file);
    const items = entry.draft.servicePeriods || {};
    if (bill && Object.keys(items).length) patch.data.servicePeriods[bill.id] = { id: bill.id, billId: bill.id, updatedAt: 1, file: entry.file, items };
  }
}
fs.writeFileSync(outPath, JSON.stringify({ app: 'house-ledger', kind: 'source-notes', v: 1, state: patch }, null, 2));
console.log(`批注单元格 ${Object.keys(patch.data.comments).length}，分项服务期 ${Object.keys(patch.data.servicePeriods).length}；账单金额和付款记录未改动`);
