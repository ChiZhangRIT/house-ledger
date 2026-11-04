// 原始 PDF 单独保存在当前设备，不进入账单 JSON 或 GitHub 同步。
import { sha256 } from '../pdf/loader.js';

let opening;
function database() {
  if (!opening) opening = new Promise((resolve, reject) => {
    const req = indexedDB.open('house-ledger-documents', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('pdfs', { keyPath: 'billId' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { opening = null; reject(req.error); };
  });
  return opening;
}
async function request(mode, action) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('pdfs', mode), req = action(tx.objectStore('pdfs'));
    tx.oncomplete = () => resolve(req.result);
    tx.onabort = () => reject(tx.error || req.error);
    tx.onerror = () => reject(tx.error || req.error);
  });
}
export const getBillPdf = id => request('readonly', s => s.get(id));
export const clearBillPdfs = () => request('readwrite', s => s.clear());

export async function readPdf(file) {
  if (!(await file.slice(0, 1024).text()).includes('%PDF-')) throw new Error('not-pdf');
  return { name: file.name, blob: file, sha256: await sha256(await file.arrayBuffer()) };
}
export const saveBillPdf = (billId, pdf) => request('readwrite', s => s.put({ ...pdf, billId, addedAt: Date.now() }));

// 有原始哈希时优先核对内容；旧导入记录只有文件名时，必须唯一匹配，重名不猜。
export function matchingBills(pdf, bills) {
  const hashMatches = pdf.sha256 ? bills.filter(b => !b.deleted && b.source?.sha256 === pdf.sha256) : [];
  if (hashMatches.length) return hashMatches;
  return bills.filter(b => !b.deleted && !b.source?.sha256 && String(b.source?.file || '').split(/[\\/]/).at(-1) === pdf.name);
}
