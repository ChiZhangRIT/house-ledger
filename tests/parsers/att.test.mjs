// AT&T Fiber 解析器测试。数据全是编造的：只模仿 pdf.js 取出来的行结构，金额、日期、账号、姓名、地址都是假的。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as att from '../../src/pdf/parsers/att.js';
import { groupLines } from '../../src/pdf/text.js';

const sum = items => Math.round(items.reduce((a, it) => a + it.amount, 0) * 100) / 100;
const run = lines => att.parse(lines, lines.join('\n'));

// 普通的一个月：周期跨年、有用量、AutoPay
const MONTHLY = [
  'JANE DOE  Page:  1 of 2',
  '123 EXAMPLE ST',
  'Issue Date:  Dec 12, 2030',
  'ANYTOWN CA 00000-0000',
  'Account Number:  0000000000-0',
  'Managing your AT&T bills, products, and services on the go? Go to',
  'att.com/myatt to sign in or sign up.',
  'Total due',
  '$55.30',
  'AutoPay is scheduled for:',
  'Jan 3, 2031',
  'Account summary',
  'Your last bill  $55.30',
  'Payment, Dec 3 - Thank you!  -$55.30',
  'Remaining balance  $0.00',
  'Service summary',
  'Internet  Page 2  $55.30',
  'Total services  $55.30',
  'Total due  $55.30',
  'AutoPay is scheduled to debit your bank account on Jan 3, 2031',
  'JANE DOE  AutoPay of $55.30 is scheduled for',
  '123 EXAMPLE ST',
  'Jan 3, 2031',
  'Account number: 0000000000-0',
  'AT&T',
  'PO BOX 0000',
  'Page:  2 of 2',
  'Issue Date:  Dec 12, 2030',
  'Account Number:  0000000000-0',
  'Service activity',
  'Internet',
  'Monthly charges  Dec 13 - Jan 12',
  'Usage summary',
  '1. Internet 300 (Fiber 300) Stand-alone  $55.00',
  'AutoPay & paperless ($5 off w/dc, $10 w/bank acct)',
  'Data',
  '[[Data||Data]]  Used',
  'Government fees & taxes',
  'Data allowance (unlimited GB)  1,234',
  '2. CA County District Sales Tax  $0.10',
  '3. CA County Sales Tax  $0.05',
  '4. CA State Sales Tax  $0.15',
  'Total for Internet  $55.30',
  'Electronic check conversion',
  'News you can use',
  'Paying by check authorizes AT&T to use the information from your check',
  'Important information',
  'A late payment fee of up to $9.99 will be assessed if payment is not received',
  'on or before the due date.',
  'Customer support  call 800.000.0000',
  '© 2030 AT&T Intellectual Property. All rights reserved.',
];

test('detect: AT&T Fiber bill yes; order confirmation and other providers no', () => {
  assert.equal(att.detect(MONTHLY.join('\n')), true);
  const order = [
    'Order Summary',
    'Order and Customer Information  Order ID: XXX0000000000',
    'Customer Name: JANE DOE  Today\'s Charges',
    'Internet Advanced Bill Payment  $10.00',
    'Package Option: Internet 300 (Fiber 300)',
    'Account Number: *****0000  Internet Charges',
    'Internet 300 (Fiber 300)  $60.00',
    'Monthly Total*:  $55.00',
    'By signing below, I agree that the AT&T Terms & Conditions were presented to me.',
  ].join('\n');
  assert.equal(att.detect(order), false);
  assert.equal(att.detect(order.replace(/^Order Summary\n/, '')), false);   // 标题没读出来也不能认成账单
  assert.equal(att.detect('Xfinity\nComcast\nAccount Number 0000000000-0\nInternet\nNew charges  $50.00'), false);
  assert.equal(att.detect('Pacific Gas and Electric Company\nENERGY STATEMENT\nAccount No: 0000000000-0\nStatement Date: 01/01/2030'), false);
  assert.equal(att.detect(''), false);
});

test('normal month: dates, period across new year, total, items, usage', () => {
  const d = run(MONTHLY);
  assert.equal(d.provider, 'att');
  assert.equal(d.statementDate, '2030-12-12');
  assert.equal(d.periodStart, '2030-12-13');
  assert.equal(d.periodEnd, '2031-01-12');
  assert.equal(d.dueDate, '2031-01-03');
  assert.equal(d.total, 55.3);
  assert.deepEqual(d.items, [
    { key: 'internet', label: 'Internet 300 (Fiber 300) Stand-alone', amount: 55 },
    { key: 'taxes', label: 'Government fees & taxes', amount: 0.3 },
  ]);
  assert.deepEqual(d.usage, [{ key: 'data', amount: 1234, unit: 'GB' }]);
  assert.equal(d.accountLast4, '0000');
  assert.deepEqual(d.warnings, []);
});

test('one-time account charge, partial-month credits and account adjustments', () => {
  const lines = [
    'JANE DOE  Page:  1 of 3',
    'Issue Date:  Mar 5, 2031',
    'Account Number:  0000000000-0',
    'Total due',
    '$70.00',
    'AutoPay is scheduled for:',
    'Mar 25, 2031',
    'Account summary',
    'Your last bill  $40.00',
    'Page 2',
    'Payments - Thank you!  -$80.00',
    'Page 2',
    'Adjustment  $40.00',
    'Remaining balance  $0.00',
    'Service summary  What\'s changed?',
    '$20.00',
    'Account charges  Page 2',
    'Last bill $0.00, Difference +$20.00  < One-time charges',
    '$50.00',
    'Internet  Page 2',
    'Last bill $55.30, Difference -$5.30  < Monthly charges, Service changes',
    'Total services  $70.00',
    'Total due  $70.00',
    'Page:  2 of 3',
    'Issue Date:  Mar 5, 2031',
    'Account Number:  0000000000-0',
    'Account activity',
    'Your last bill  $40.00',
    'Payments',
    '1. Direct Pay posted  Feb 20  -$40.00',
    '2. Direct Pay posted  Feb 28  -$40.00',
    'Total for payments  -$80.00',
    'Adjustments',
    '3. Insufficient Funds posted  Feb 24  $40.00',
    'Total for adjustments  $40.00',
    'Remaining balance  $0.00',
    'Service activity',
    'Account charges',
    'Activity since last bill  Feb 6 - Mar 5',
    '1. Returned Check Charge  Feb 24  $20.00  < One-time charge',
    'Total for Account charges  $20.00',
    'Internet',
    'Activity since last bill  Feb 6 - Mar 5',
    '1. Internet 300 (Fiber 300) Stand-alone  Feb 10 - Mar 1  -$8.00  < Promotion removed on Mar 1 - partial month credit',
    'AutoPay & paperless disc ($5 off w/cc, $10 off w/bank acct)',
    '2. Internet 300 (Fiber 300) Stand-alone  Feb 10 - Mar 5  $2.70  < Promotion removed on Feb 10 - previous credit',
    'AutoPay & paperless bill discount ($5 off with credit card)  reversed',
    'Monthly charges  Mar 6 - Apr 5',
    '3. Internet 300 (Fiber 300) Stand-alone  $55.00',
    'Government fees & taxes',
    '4. CA County District Sales Tax  $0.10',
    '5. CA County Sales Tax  $0.05',
    '6. CA State Sales Tax  $0.15',
    'Total for Internet  $50.00',
    'Page:  3 of 3',
    'Issue Date:  Mar 5, 2031',
    'Account Number:  0000000000-0',
    'News you can use',
    'Important information',
  ];
  const d = run(lines);
  assert.equal(d.statementDate, '2031-03-05');
  assert.equal(d.periodStart, '2031-03-06');
  assert.equal(d.periodEnd, '2031-04-05');
  assert.equal(d.dueDate, '2031-03-25');
  assert.equal(d.total, 70);
  assert.deepEqual(d.items, [
    { key: 'internet', label: 'Internet 300 (Fiber 300) Stand-alone', amount: 55 },
    { key: 'proration', label: 'Partial-month adjustments', amount: -5.3 },
    { key: 'taxes', label: 'Government fees & taxes', amount: 0.3 },
    { key: 'account_charges', label: 'Returned Check Charge', amount: 20 },
  ]);
  assert.equal(sum(d.items), d.total);
  assert.deepEqual(d.usage, []);
  assert.equal(d.warnings.length, 2);
  assert.match(d.warnings[0], /Returned Check Charge.*\$20\.00/);
  assert.match(d.warnings[1], /调整.*Insufficient Funds posted \$40\.00/);
});

test('later credit shows up only as a warning, not in the total', () => {
  const lines = MONTHLY.slice();
  const k = lines.indexOf('Remaining balance  $0.00');
  lines.splice(k, 0, 'Adjustment  -$5.00');
  const j = lines.indexOf('Service activity');
  lines.splice(j, 0, 'Account activity', 'Adjustments', '2. Account Level Credit  Dec 1  -$5.00', 'Remaining balance  $0.00');
  const d = run(lines);
  assert.equal(d.total, 55.3);
  assert.equal(sum(d.items), 55.3);
  assert.equal(d.warnings.length, 1);
  assert.match(d.warnings[0], /Account Level Credit -\$5\.00/);
});

test('first bill: prepaid credit balance warned, free installation skipped', () => {
  const lines = [
    'JANE DOE  Page:  1 of 2',
    'Issue Date:  Jun 2, 2030',
    'Account Number:  0000000000-0',
    'billed in advance. The amount due may be higher than expected and more than you\'ll see  Total due',
    'going forward.',
    'AutoPay is scheduled for:',
    'Jun 20, 2030',
    'Account summary',
    'Payment, Jun 1 - Thank you!  -$10.00',
    'Credit balance  -$10.00',
    'Service summary',
    'Internet  Page 2  $60.40',
    'Total services  $60.40',
    'Total due  $50.40',
    'Page:  2 of 2',
    'Issue Date:  Jun 2, 2030',
    'Account Number:  0000000000-0',
    'Service activity',
    'Internet',
    'Activity since last bill  Jun 2 - Jun 2',
    '1. Installation  Jun 3  $0.00  < One-time charge',
    'Monthly charges  Jun 3 - Jul 2',
    '2. Internet 300 (Fiber 300) Stand-alone  $60.00',
    'AutoPay & paperless bill discount ($5 off with credit card)',
    'Government fees & taxes',
    '3. CA County District Sales Tax  $0.10',
    '4. CA County Sales Tax  $0.10',
    '5. CA State Sales Tax  $0.20',
    'Total for Internet  $60.40',
    'Important information',
  ];
  const d = run(lines);
  assert.equal(d.total, 60.4);
  assert.equal(d.periodStart, '2030-06-03');
  assert.equal(d.periodEnd, '2030-07-02');
  assert.deepEqual(d.items.map(it => it.key), ['internet', 'taxes']);
  assert.equal(d.warnings.length, 1);
  assert.match(d.warnings[0], /上期余额 -\$10\.00/);
});

test('separately listed discount and equipment fee become their own items', () => {
  const lines = MONTHLY.map(l => l
    .replace('Internet  Page 2  $55.30', 'Internet  Page 2  $57.30')
    .replace('Total services  $55.30', 'Total services  $57.30')
    .replace('Total for Internet  $55.30', 'Total for Internet  $57.30'));
  const k = lines.indexOf('Government fees & taxes');
  lines.splice(k, 0,
    'Discounts',
    '5. AutoPay & paperless bill discount  -$5.00',
    'Equipment',
    '6. Wi-Fi Gateway Fee  $7.00');
  const d = run(lines);
  assert.equal(d.total, 57.3);
  assert.deepEqual(d.items, [
    { key: 'internet', label: 'Internet 300 (Fiber 300) Stand-alone', amount: 55 },
    { key: 'discount', label: 'AutoPay & paperless bill discount', amount: -5 },
    { key: 'equipment', label: 'Wi-Fi Gateway Fee', amount: 7 },
    { key: 'taxes', label: 'Government fees & taxes', amount: 0.3 },
  ]);
  assert.deepEqual(d.warnings, []);
});

test('items that do not add up to the total produce a warning', () => {
  const lines = MONTHLY.filter(l => l !== '3. CA County Sales Tax  $0.05');
  const d = run(lines);
  assert.equal(d.total, 55.3);
  assert.equal(sum(d.items), 55.25);
  assert.ok(d.warnings.some(w => /Internet.*\$55\.25.*\$55\.30/.test(w)), d.warnings.join('\n'));
  assert.ok(d.warnings.some(w => /分项相加 \$55\.25 和本期费用 \$55\.30 差 \$0\.05/.test(w)), d.warnings.join('\n'));
});

test('missing Monthly charges date falls back to an estimated period with a warning', () => {
  const lines = MONTHLY.map(l => (l.startsWith('Monthly charges') ? 'Monthly charges' : l));
  const d = run(lines);
  assert.equal(d.periodStart, '2030-12-13');
  assert.equal(d.periodEnd, '2031-01-12');
  assert.ok(d.warnings.some(w => /Monthly charges/.test(w)));
});

test('OCR-style text with single spaces parses the same', () => {
  const ocr = MONTHLY.map(l => l.replace(/\s+/g, ' '));
  assert.equal(att.detect(ocr.join('\n')), true);
  const a = run(MONTHLY), b = run(ocr);
  assert.deepEqual(b, a);
});

test('works on lines built by groupLines from pdf.js text items', () => {
  // 模拟 pdf.js 的文字块：同一行左边是名称，右边远处是金额
  const it = (s, x, y, w = s.length * 5) => ({ str: s, transform: [1, 0, 0, 1, x, y], width: w });
  const items = [
    it('Issue Date:', 400, 760), it('Dec 12, 2030', 470, 760),
    it('Account Number:', 400, 748), it('0000000000-0', 490, 748),
    it('Total services', 40, 600), it('$55.30', 500, 600),
    it('AT&T', 40, 590),
    it('Service activity', 40, 560),
    it('Internet', 40, 548),
    it('Monthly charges', 40, 536), it('Dec 13 - Jan 12', 200, 536),
    it('1. Internet 300 (Fiber 300) Stand-alone', 40, 524, 200), it('$55.00', 500, 524),
    it('Government fees & taxes', 40, 512),
    it('2. CA State Sales Tax', 40, 500, 110), it('$0.30', 500, 500),
    it('Total for Internet', 40, 488), it('$55.30', 500, 488),
  ];
  const lines = groupLines(items);
  assert.equal(att.detect(lines.join('\n')), true);
  const d = run(lines);
  assert.equal(d.total, 55.3);
  assert.equal(d.periodEnd, '2031-01-12');
  assert.deepEqual(d.items.map(i => [i.key, i.amount]), [['internet', 55], ['taxes', 0.3]]);
  assert.deepEqual(d.warnings, []);
});

// ---- 下面是复核时补的：右栏并行、各种负号、OCR 的错字、翻页、标题丢失等（数据同样是编的）----

const values = d => [d.statementDate, d.periodStart, d.periodEnd, d.dueDate, d.total, d.items, d.usage, d.accountLast4];

test('tax heading merged with the right-hand usage column is still the tax heading', () => {
  const lines = MONTHLY.filter(l => !l.startsWith('Data allowance'))
    .map(l => (l === 'Government fees & taxes' ? 'Government fees & taxes  Data allowance (unlimited GB)  1,234' : l));
  const d = run(lines);
  assert.deepEqual(values(d), values(run(MONTHLY)));
  assert.deepEqual(d.warnings, []);
  // OCR：只剩一个空格
  const ocr = run(lines.map(l => l.replace(/\s+/g, ' ')));
  assert.deepEqual(ocr.items, d.items);
  assert.deepEqual(ocr.usage, [{ key: 'data', amount: 1234, unit: 'GB' }]);
});

test('negative amounts written with a Unicode minus, an en dash, "- $" or CR keep their sign', () => {
  const base = [
    'Issue Date:  Mar 5, 2031', 'Account Number:  000000000', 'AT&T',
    'Account summary', 'Your last bill  $55.00', 'Payment, Feb 25 - Thank you!  -$55.00', 'Adjustment  -$5.00', 'Remaining balance  $0.00',
    'Total services  $47.10',
    'Account activity', 'Adjustments', '2. Courtesy credit  Feb 20  -$5.00', 'Remaining balance  $0.00',
    'Service activity', 'Internet', 'Activity since last bill  Feb 6 - Mar 5',
    '1. Internet 300 (Fiber 300) Stand-alone  Feb 10 - Mar 5  -$8.00  < Promotion removed on Feb 10 - partial month',
    'Monthly charges  Mar 6 - Apr 5', '2. Internet 300 (Fiber 300) Stand-alone  $55.00',
    'Government fees & taxes', '3. CA State Sales Tax  $0.10', 'Total for Internet  $47.10',
  ];
  const expected = run(base);
  assert.deepEqual(expected.items.map(i => [i.key, i.amount]), [['internet', 55], ['proration', -8], ['taxes', 0.1]]);
  assert.match(expected.warnings.join('\n'), /Courtesy credit -\$5\.00/);
  for (const variant of [s => s.replace(/-\$/g, '−$'), s => s.replace(/-\$/g, '–$'), s => s.replace(/-\$/g, '- $'), s => s.replace(/-\$(\d+\.\d\d)/g, '$$$1 CR')]) {
    const d = run(base.map(variant));
    assert.deepEqual(values(d), values(expected));
    assert.deepEqual(d.warnings, expected.warnings);
  }
});

test('OCR text: no $ signs, glued page headers, header merged with address, leading spaces', () => {
  const ocr = MONTHLY.map(l => l
    .replace(/\$(?=\d)/g, '')
    .replace('Page:  1 of 2', 'Page:  1of2')
    .replace(/^Page:  2 of 2$/, 'Page:  2of2')
    .replace(/^Account Number:  (.*)$/, 'AT&T  Account Number: $1')
    .replace(/\s+/g, ' ')
    .replace(/^/, '  '));
  assert.equal(att.detect(ocr.join('\n')), true);
  const d = run(ocr);
  assert.deepEqual(values(d), values(run(MONTHLY)));
  assert.deepEqual(d.warnings, []);
});

test('one item amount lost by OCR is worked out from the section total, with a warning', () => {
  const lines = MONTHLY.map(l => (l === '1. Internet 300 (Fiber 300) Stand-alone  $55.00' ? '1. Internet 300 (Fiber 300) Stand-alone  $5500' : l));
  const d = run(lines);
  assert.deepEqual(d.items, run(MONTHLY).items);
  assert.equal(d.warnings.length, 1);
  assert.match(d.warnings[0], /Internet 300 \(Fiber 300\) Stand-alone.*没有读到金额.*倒推为 \$55\.00/);
  // 丢了两项就不猜了，只提醒
  const two = run(lines.map(l => l.replace('$0.05', '$005')));
  assert.equal(two.total, 55.3);
  assert.ok(two.warnings.filter(w => /没有读到金额/.test(w)).length === 2, two.warnings.join('\n'));
  assert.ok(two.warnings.some(w => /分项相加/.test(w)), two.warnings.join('\n'));
});

test('unreadable Monthly charges date: period comes from the issue date, not from "Activity since last bill"', () => {
  const lines = [
    'Issue Date:  Mar 5, 2031', 'Account Number:  000000000', 'AT&T', 'Total services  $47.10',
    'Service activity', 'Internet', 'Activity since last bill  Feb 6 - Mar 5',
    '1. Internet 300 (Fiber 300) Stand-alone  Feb 10 - Mar 5  -$8.00',
    'Monthly charges  Mxr 6 - Apx 5', '2. Internet 300 (Fiber 300) Stand-alone  $55.00',
    'Government fees & taxes', '3. CA State Sales Tax  $0.10', 'Total for Internet  $47.10',
  ];
  const d = run(lines);
  assert.equal(d.periodStart, '2031-03-06');
  assert.equal(d.periodEnd, '2031-04-05');
  assert.match(d.warnings.join('\n'), /按账单日期估算/);
  // 最后一张账单（停机后只有按天退费，没有 Monthly charges）：用 Activity since last bill 的区间
  const last = run([
    'Issue Date:  Mar 5, 2031', 'Account Number:  000000000', 'AT&T', 'Total services  -$20.00',
    'Service activity', 'Internet', 'Activity since last bill  Feb 6 - Mar 5',
    '1. Internet 300 (Fiber 300) Stand-alone  Feb 20 - Mar 5  -$20.00  < Service ended - partial month credit',
    'Total for Internet  -$20.00',
  ]);
  assert.equal(last.total, -20);
  assert.equal(last.periodStart, '2031-02-06');
  assert.equal(last.periodEnd, '2031-03-05');
  assert.deepEqual(last.items, [{ key: 'proration', label: 'Partial-month adjustments', amount: -20 }]);
});

test('sections split by a page break (with unrelated text in between) are all read', () => {
  const lines = [
    'JANE DOE  Page:  1 of 3', 'Issue Date:  Mar 5, 2031', 'Account Number:  000000000', 'AT&T',
    'Service summary', 'Account charges  Page 2  $10.00', 'Internet  Page 3  $55.10', 'Total services  $65.10',
    'Page:  2 of 3', 'Issue Date:  Mar 5, 2031', 'Account Number:  000000000',
    'Service activity', 'Account charges', 'Activity since last bill  Feb 6 - Mar 5',
    '1. Late Payment Fee  Feb 28  $10.00  < One-time charge', 'Total for Account charges  $10.00',
    'Electronic check conversion', 'Paying by check authorizes AT&T to use the information from your check',
    'JANE DOE  Page:  3 of 3', 'Issue Date:  Mar 5, 2031', 'AT&T', 'Account Number:  000000000',
    'Internet', 'Monthly charges  Mar 6 - Apr 5', '2. Internet 300 (Fiber 300) Stand-alone  $55.00',
    'Usage summary', 'Important information', 'Internet (continued)',
    'Government fees & taxes', '3. CA State Sales Tax  $0.10', 'Total for Internet  $55.10',
    'News you can use', '1. Visit att.com to see more offers  $0.99',
  ];
  const d = run(lines);
  assert.equal(d.total, 65.1);
  assert.deepEqual(d.items.map(i => [i.key, i.amount]), [['internet', 55], ['taxes', 0.1], ['account_charges', 10]]);
  assert.equal(d.periodStart, '2031-03-06');
  assert.equal(d.warnings.length, 1);
  assert.match(d.warnings[0], /Late Payment Fee/);
});

test('missing "Service activity" heading (OCR) still reads the detail, with a warning', () => {
  const d = run(MONTHLY.filter(l => l !== 'Service activity'));
  assert.deepEqual(values(d), values(run(MONTHLY)));
  assert.equal(d.warnings.length, 1);
  assert.match(d.warnings[0], /Service activity/);
});

test('thousands separators, negative total, named discounts, unit prices, notes next to the total', () => {
  const lines = [
    'Issue Date:  Mar 5, 2031', 'Account Number:  *****0000', 'AT&T',
    'Total services  -$1,010.00  Last bill $1,234.00, Difference -$2,244.00',
    'Service activity', 'Internet', 'Monthly charges  Mar 6 - Apr 5',
    '1. Internet 5000 (Fiber 5000) Stand-alone  $1,200.00',
    '2. Wi-Fi Extender (2 @ $5.00)  $10.00',
    '3. Internet Loyalty Discount  -$2,220.00',
    'Total for Internet  -$1,010.00',
  ];
  const d = run(lines);
  assert.equal(d.total, -1010);
  assert.deepEqual(d.items, [
    { key: 'internet', label: 'Internet 5000 (Fiber 5000) Stand-alone', amount: 1200 },
    { key: 'discount', label: 'Internet Loyalty Discount', amount: -2220 },
    { key: 'equipment', label: 'Wi-Fi Extender (2 @ $5.00)', amount: 10 },
  ]);
  assert.equal(d.accountLast4, '0000');
  assert.deepEqual(d.warnings, []);
  const ocr = run(lines.map(l => l.replace(/\s+/g, ' ')));
  assert.deepEqual(ocr.items.map(i => [i.key, i.amount]), d.items.map(i => [i.key, i.amount]));
  assert.equal(ocr.total, -1010);
});

test('detect: AT&T bill without an Internet service (e.g. wireless only) is not an AT&T Fiber bill; case does not matter', () => {
  const wireless = [
    'Issue Date:  Mar 5, 2031', 'Account Number:  000000000000', 'Service summary', 'Wireless  Page 2  $85.00', 'Total services  $85.00',
    'Service activity', 'Wireless', 'Monthly charges  Mar 6 - Apr 5', '1. Unlimited Plan  $85.00', 'Total for Wireless  $85.00',
    'Internet usage allowance', 'AT&T Internet and AT&T Phone provided by AT&T California.',
  ].join('\n');
  assert.equal(att.detect(wireless), false);
  assert.equal(att.detect(MONTHLY.join('\n').toLowerCase()), true);
  assert.equal(att.detect(MONTHLY.join('\n').toUpperCase()), true);
});

test('parse works when only the text is given', () => {
  const d = att.parse([], MONTHLY.join('\r\n'));
  assert.deepEqual(values(d), values(run(MONTHLY)));
});

test('unpaid previous balance: total stays the new charges, the balance is only a warning', () => {
  const lines = MONTHLY.map(l => l
    .replace('Payment, Dec 3 - Thank you!  -$55.30', 'Payment, Dec 3 - Thank you!  -$0.00')
    .replace('Remaining balance  $0.00', 'Past due  $55.30')
    .replace('Total due  $55.30', 'Total due  $110.60')
    .replace('Internet 300 (Fiber 300)', 'Internet 300 (ﬁber 300)'));   // OCR 的连字「ﬁ」
  const d = run(lines);
  assert.equal(d.total, 55.3);
  assert.deepEqual(d.items, [
    { key: 'internet', label: 'Internet 300 (fiber 300) Stand-alone', amount: 55 },
    { key: 'taxes', label: 'Government fees & taxes', amount: 0.3 },
  ]);
  assert.equal(d.warnings.length, 1);
  assert.match(d.warnings[0], /上期余额 \$55\.30（没付清的钱）/);
});
