// 读一份账单 PDF：取文字 → 认出是哪家的账单 → 用那家的规则解析成「账单草稿」，让用户确认后保存。
//
// 账单草稿（BillDraft）的格式，所有解析器都输出这个：
// {
//   provider: 'pge' | 'sunnyvale' | 'att' | 'xfinity',
//   statementDate: 'YYYY-MM-DD',          // 账单日期
//   periodStart: 'YYYY-MM-DD',            // 服务周期开始
//   periodEnd: 'YYYY-MM-DD',              // 服务周期结束
//   dueDate: 'YYYY-MM-DD' | null,         // 到期日
//   total: 123.45,                        // 本期新产生的费用（不含上期余额、已付款）
//   items: [{ key: 'electric_delivery', label: 'Electric Delivery', amount: 12.34 }, ...],  // 分项，加起来等于 total
//   usage: [{ key: 'electricity', amount: 312, unit: 'kWh' }, ...],                       // 用量（有就填）
//   accountLast4: '1234' | null,          // 只保留账号后四位
//   warnings: ['…'],                      // 解析时拿不准的地方
// }
import { pdfLines } from './text.js';
import * as pge from './parsers/pge.js';
import * as sunnyvale from './parsers/sunnyvale.js';
import * as att from './parsers/att.js';
import * as xfinity from './parsers/xfinity.js';

export const PARSERS = [pge, sunnyvale, att, xfinity];

// 常见英文词：文字层是乱码（字体没有 Unicode 对照表，比如 2025 年以前的 PG&E 账单）时一个都找不到，
// 正常账单至少有几十个。用来区分「读不出文字」和「认不出是哪家」。
const COMMON = /^(the|and|for|you|your|total|amount|account|service|services|charges?|date|payment|due|bill|billing|from|page|balance|usage|energy|electric|gas|water|statement|current|period|new|monthly|please|customer|number)$/i;
export function looksReadable(text) {
  let n = 0;
  for (const w of text.match(/[A-Za-z]{3,}/g) || []) if (COMMON.test(w) && ++n >= 5) return true;
  return false;
}

/** 已经取出文字行时用（OCR 的结果也走这里） */
export function parseBillLines(lines) {
  const text = lines.join('\n');
  const parser = PARSERS.find(p => p.detect(text));
  if (!parser) return { ok: false, reason: looksReadable(text) ? 'unknown-provider' : 'unreadable' };
  try {
    return { ok: true, draft: parser.parse(lines, text) };
  } catch (e) {
    return { ok: false, reason: 'parse-error', provider: parser.id, message: String(e && e.message || e) };
  }
}

/** 从 PDF 文件内容开始 */
export async function parseBillPdf(pdfjs, data) {
  const { pages } = await pdfLines(pdfjs, data);
  return parseBillLines(pages.flat());
}
