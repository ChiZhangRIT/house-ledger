// 解析用户输入的金额：'$1,234.5' / '-12' / '−12' / '(12.00)' → 数字（两位小数）；认不出来返回 null
export function parseAmount(s) {
  if (typeof s === 'number') return Number.isFinite(s) ? Math.round(s * 100) / 100 : null;
  const x = String(s || '').replace(/[\s$,]/g, '').replace(/^[−–]/, '-').replace(/^\((.*)\)$/, '-$1');
  if (!x || !/^-?\d*\.?\d+$/.test(x)) return null;
  return Math.round(Number(x) * 100) / 100;
}
