import test from 'node:test';
import assert from 'node:assert/strict';
import { matchingBills, readPdf } from '../src/core/documents.js';

test('PDF 关联优先核对原始内容；不把同名但哈希不同的文件归到账单', () => {
  const bills = [{ id: 'a', source: { sha256: 'known', file: 'bill.pdf' } }, { id: 'b', source: { file: 'bill.pdf' } }];
  assert.deepEqual(matchingBills({ name: 'renamed.pdf', sha256: 'known' }, bills).map(b => b.id), ['a']);
  assert.deepEqual(matchingBills({ name: 'bill.pdf', sha256: 'different' }, bills).map(b => b.id), ['b']);
  assert.deepEqual(matchingBills({ name: 'bill.pdf', sha256: 'different' }, bills.slice(0, 1)), []);
});

test('旧记录按完整原文件名匹配；重名保持歧义，删除记录和未匹配文件不关联', () => {
  const bills = [{ id: 'a', source: { file: '/old/bill.pdf' } }, { id: 'b', source: { file: 'C:\\old\\bill.pdf' } }, { id: 'c', deleted: true, source: { file: 'other.pdf' } }];
  assert.equal(matchingBills({ name: 'bill.pdf' }, bills).length, 2);
  assert.deepEqual(matchingBills({ name: 'other.pdf' }, bills), []);
  assert.deepEqual(matchingBills({ name: 'renamed.pdf' }, bills), []);
});

test('关联文件校验 PDF 内容，保留原始字节，伪装成 PDF 的文本被拒绝', async () => {
  const file = Object.assign(new Blob(['%PDF-1.7\noriginal bytes']), { name: 'bill.pdf' });
  const pdf = await readPdf(file);
  assert.equal(pdf.name, file.name);
  assert.equal(await pdf.blob.text(), await file.text());
  assert.match(pdf.sha256, /^[a-f0-9]{64}$/);
  await assert.rejects(() => readPdf(Object.assign(new Blob(['not a pdf']), { name: 'fake.pdf' })), /not-pdf/);
});
