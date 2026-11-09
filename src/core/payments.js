// 一笔实际转账只保存一次；用途分配的合计必须等于转账总额。
export const isHousingPayment = payment => ['rent', 'deposit', 'housing'].includes(payment.purpose);

export function paymentAllocations(payment) {
  if (!isHousingPayment(payment)) return [];
  if (Array.isArray(payment.allocations)) return payment.allocations;
  return payment.purpose === 'housing' ? [] : [{ purpose: payment.purpose, rentId: payment.rentId || null, amount: payment.amount }];
}

export function allocationError(payment) {
  if (payment.allocations === undefined && payment.purpose !== 'housing') return null;
  if (!isHousingPayment(payment)) return 'purpose';
  if (!Array.isArray(payment.allocations) || !payment.allocations.length) return 'required';
  if (!Number.isFinite(payment.amount) || Math.abs(payment.amount) > 1e7) return 'amount';
  let sum = 0;
  const targets = new Set();
  for (const part of payment.allocations) {
    if (!part || !['rent', 'deposit'].includes(part.purpose) || (part.rentId != null && typeof part.rentId !== 'string') || (part.purpose === 'deposit' && part.rentId)) return 'purpose';
    if (!Number.isFinite(part.amount) || Math.abs(part.amount) > 1e7 || Math.sign(part.amount) !== Math.sign(payment.amount)) return 'amount';
    const key = part.purpose + ':' + (part.rentId || '');
    if (targets.has(key)) return 'duplicate';
    targets.add(key); sum += Math.round(part.amount * 100);
  }
  return sum === Math.round(payment.amount * 100) ? null : 'total';
}

/** 从任一分配明细编辑时，回到原始转账，避免将一部分误当成整笔金额。 */
export const paymentTransfer = (state, payment) => payment?.transferId ? state.data.payments[payment.transferId] || payment : payment;

export function paymentPortion(payment, part) {
  return { ...payment, id: 'part:' + encodeURIComponent(payment.id) + ':' + part.purpose + ':' + encodeURIComponent(part.rentId || ''),
    purpose: part.purpose, rentId: part.rentId || null, amount: part.amount, transferId: payment.id };
}
