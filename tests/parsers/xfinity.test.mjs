// Xfinity 解析器测试：下面的账单文字全是编造的（模仿 pdf.js 取出的行结构，列之间两个空格），
// 金额、日期、账号、姓名、地址都不是真实数据。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detect, parse, id, category } from '../../src/pdf/parsers/xfinity.js';

const ACCT = '0000 00 000 0000000';
const sumItems = d => Math.round(d.items.reduce((s, it) => s + it.amount, 0) * 100) / 100;
const run = lines => { const text = lines.join('\n'); return { ok: detect(text), d: parse(lines, text) }; };

const header = (billDate, period, page = '1 of 3') => [
  period ? 'Account Number  Billing Date  Services From  Page' : 'Account Number  Billing Date  Page',
  `${ACCT}  ${billDate}${period ? `  ${period}` : ''}  ${page}`,
];
const stub = (autoPay, pay) => [
  'Detach the bottom portion of this bill and enclose with your payment  Please write your account number on your check or money order',
  `Account number  ${ACCT}`,
  ...(autoPay ? [`Automatic payment  ${autoPay}`, `1 EXAMPLE PLAZA  Please pay  ${pay}`, `Electronic payment will be applied ${autoPay}`] : []),
  'TEST USER',
  '100 EXAMPLE ST',
  'ANYTOWN, CA 00000-0000',
  'COMCAST',
  'P.O. BOX 00000',
  'EXAMPLE CITY CA 00000-0000',
];

// 旧版：套餐价已经扣掉折扣，只写「Includes …」
const OLD_STYLE = [
  ...header('Mar 12, 2031', 'Mar 17, 2031 to Apr 16, 2031'),
  'Hello Test User,',
  'Thank you for choosing Xfinity.',
  'Your bill at a glance  Your bill explained',
  'For 100 EXAMPLE ST, ANYTOWN, CA, 00000-0000',
  'Previous balance  $41.00  bill. A detailed breakdown of your charges begins on',
  'EFT Payment - thank you  Mar 08  -$41.00  services will increase by $3.00.',
  'Balance forward  $0.00',
  'Regular monthly charges  Page 3  $41.00',
  'Taxes, fees and other charges  $0.00',
  'New charges  $41.00',
  'Amount due  $41.00',
  'Thanks for paying by Automatic Payment',
  'Your automatic payment on Apr 07, 2031, will include your',
  ...stub('Apr 07, 2031', '$41.00'),
  ...header('Mar 12, 2031', 'Mar 17, 2031 to Apr 16, 2031', '2 of 3'),
  ...header('Mar 12, 2031', 'Mar 17, 2031 to Apr 16, 2031', '3 of 3'),
  "Regular monthly charges  $41.00  What's included?",
  'Your Xfinity package  $41.00  Internet: Download as fast as 100 Mbps',
  'Internet: Example Speed  $41.00',
  'Internet  This shows a service is included in your package:',
  'Includes a 24 month $20.00 Service Discount that will end on Jan 31, 2033',
  'Includes $7.00 Automatic Payments Discount Including Paperless Billing',
  'Bonus Streaming ($3.99 value)  $0.00',
  "You've saved $27.00 this month with your",
  'Equipment & services  $0.00',
  'Streaming TV Box Rental',
  'Additional information',
  'You have 120 days from the date of this bill to dispute any charges included',
];

// 新版：服务原价 + 折扣分开列，还有改套餐的按天折算
const NEW_STYLE_PARTIAL = [
  ...header('Jun 05, 2031', 'Jun 10, 2031 to Jul 09, 2031', '1 of 4'),
  'Hello Test User,',
  'Your bill at a glance  Your bill explained',
  '• We\'ve applied a partial charge of -$6.10 as a result',
  'Previous balance  $55.00  of Example Plan change(s) made to your',
  'Credit card payment - thank you  Jun 01  -$55.00  account on May 20.',
  'Balance forward  $0.00',
  '• Regular monthly charges have decreased by $15.00 as',
  'Partial charges  Page 3  -$6.10',
  '• This page gives you a quick summary of your monthly',
  'Regular monthly charges  Page 3  $40.00',
  'bill. A detailed breakdown of your charges begins on',
  'Taxes, fees and other charges  $0.00  page 3.',
  'New charges  $33.90',
  'Amount due  $33.90',
  ...stub('Jun 30, 2031', '$33.90'),
  ...header('Jun 05, 2031', 'Jun 10, 2031 to Jul 09, 2031', '3 of 4'),
  'Your regular monthly charges have changed',
  'Regular monthly charges  Partial charges',
  'Last month  $55.00',
  'This month  $40.00  -$6.10',
  'Partial charges  -$6.10',
  'Services removed  May 20 - Jun 09  -$20.00  Please note: Credits for service you were billed',
  'Example Plan',
  'Services added  May 20 - Jun 09  $13.90  Please note: Charge for new service up to',
  'We\'ve applied a credit of -$6.10 as a result of your change(s) on May 20.',
  "Regular monthly charges  $40.00  What's included?",
  'My Xfinity plan  $40.00  Internet: Download as fast as 200 Mbps',
  'My Xfinity services  $70.00',
  'This shows a service is included in your package:',
  'Internet: Example More  $70.00',
  'Discounts  -$30.00',
  'Promotional Discount  -$22.00  You\'ve saved $30.00 this month with your',
  'Includes a 24 month $22.00 Promotional Discount that will end on May 31, 2033  promotional and automatic payments',
  'Automatic Payments Discount  -$8.00',
  'Including Paperless Billing',
  'Equipment & services  $0.00',
  'Streaming TV Box Rental',
  'continues...',
  ...header('Jun 05, 2031', 'Jun 10, 2031 to Jul 09, 2031', '4 of 4'),
  '...continued',
  'Internet/Voice Equipment',
  'Qty 2',
  'Additional information',
];

test('module metadata', () => {
  assert.equal(id, 'xfinity');
  assert.equal(category, 'internet');
});

test('old-style bill: dates, total, single internet item, autopay date as due date', () => {
  const { ok, d } = run(OLD_STYLE);
  assert.equal(ok, true);
  assert.equal(d.provider, 'xfinity');
  assert.equal(d.statementDate, '2031-03-12');
  assert.equal(d.periodStart, '2031-03-17');   // 「Services From」= 预收的下一个周期
  assert.equal(d.periodEnd, '2031-04-16');
  assert.equal(d.dueDate, '2031-04-07');
  assert.equal(d.total, 41);
  assert.deepEqual(d.items, [{ key: 'internet', label: 'Internet: Example Speed', amount: 41 }]);
  assert.deepEqual(d.usage, []);
  assert.equal(d.accountLast4, '0000');
  assert.deepEqual(d.warnings, []);
});

test('new-style bill: services and discounts listed separately, partial charges kept as one item', () => {
  const { ok, d } = run(NEW_STYLE_PARTIAL);
  assert.equal(ok, true);
  assert.equal(d.statementDate, '2031-06-05');
  assert.equal(d.periodStart, '2031-06-10');
  assert.equal(d.periodEnd, '2031-07-09');
  assert.equal(d.total, 33.9);
  assert.deepEqual(d.items.map(it => [it.key, it.amount]), [
    ['partial_charges', -6.1],
    ['internet', 70],
    ['promotional_discount', -22],
    ['automatic_payments_discount', -8],
  ]);
  assert.equal(sumItems(d), d.total);
  assert.equal(d.warnings.length, 1);
  assert.match(d.warnings[0], /Partial charges -\$6\.10/);
});

test('past-due bill: "New charges due <date>" is the total and due date; past due balance is not counted', () => {
  const lines = [
    ...header('Sep 03, 2031', 'Sep 08, 2031 to Oct 07, 2031'),
    'Your bill at a glance  Your bill explained',
    'Previous balance  $38.00  3, 2031 will show up on your next bill. View your',
    'Payments  $0.00  most up-to-date account balance at xfinity.com/',
    'Past due balance  $38.00',
    'Regular monthly charges  Page 3  $38.00',
    'Taxes, fees and other charges  $0.00',
    'New charges due Sep 24, 2031  $38.00',
    'Amount due  $76.00',
    'Your account is past due',
    ...stub(null),
    'Past due balance  $38.00',
    'New charges due Sep 24, 2031  $38.00',
    'Total amount due  $76.00',
    ...header('Sep 03, 2031', 'Sep 08, 2031 to Oct 07, 2031', '3 of 3'),
    "Regular monthly charges  $38.00  What's included?",
    'My Xfinity plan  $38.00',
    'My Xfinity services  $60.00',
    'Internet: Example More  $60.00',
    'Discounts  -$22.00',
    'Promotional Discount  -$22.00',
    'Equipment & services  $0.00',
    'Additional information',
  ];
  const { ok, d } = run(lines);
  assert.equal(ok, true);
  assert.equal(d.total, 38);
  assert.equal(d.dueDate, '2031-09-24');
  assert.deepEqual(d.items.map(it => [it.key, it.amount]), [['internet', 60], ['promotional_discount', -22]]);
  assert.deepEqual(d.warnings, []);
});

test('final bill after disconnect: no Services From, period comes from the credit lines, negative total', () => {
  const lines = [
    ...header('Oct 02, 2031', null),
    'Hello Test User,',
    'Your Xfinity services have been disconnected at your request.',
    'Your bill at a glance  Your bill explained',
    '• Your credit balance refund of -$9.00 will be ready',
    'Previous balance  $70.00  within 30 days of the date service was disconnected',
    'Credit card payment - thank you  Sep 26  -$35.00  and all Comcast-owned equipment was returned.',
    'Balance forward  $35.00',
    'Partial charges  Page 3  -$44.00',
    'Taxes, fees and other charges  $0.00',
    'New charges  -$44.00  within 15 days, will receive a physical prepaid card for a',
    'New balance  -$9.00',
    ...stub(null),
    'New credit balance  -$9.00',
    ...header('Oct 02, 2031', null, '3 of 3'),
    'Partial charges  -$44.00',
    'Services removed  Sep 20 - Oct 21  -$44.00  Please note: Credits for services you were billed',
    'Example Plan',
    'Additional information',
  ];
  const { ok, d } = run(lines);
  assert.equal(ok, true);
  assert.equal(d.statementDate, '2031-10-02');
  assert.equal(d.periodStart, '2031-09-20');
  assert.equal(d.periodEnd, '2031-10-21');
  assert.equal(d.dueDate, null);
  assert.equal(d.total, -44);
  assert.deepEqual(d.items, [{ key: 'partial_charges', label: 'Partial charges', amount: -44 }]);
  assert.ok(d.warnings.some(w => /最终账单/.test(w) && /2031-09-20 ~ 2031-10-21/.test(w)));
  assert.ok(d.warnings.some(w => /负数/.test(w)));
});

test('final-bill credit range across new year gets the right years', () => {
  const lines = [
    ...header('Jan 03, 2032', null),
    'Your Xfinity services have been disconnected at your request.',
    'Previous balance  $30.00',
    'Balance forward  $0.00',
    'Partial charges  Page 3  -$25.00',
    'New charges  -$25.00',
    ...stub(null),
    ...header('Jan 03, 2032', null, '3 of 3'),
    'Partial charges  -$25.00',
    'Services removed  Dec 28 - Jan 26  -$25.00',
    'Additional information',
  ];
  const { d } = run(lines);
  assert.equal(d.periodStart, '2031-12-28');
  assert.equal(d.periodEnd, '2032-01-26');
});

test('first bill after moving: balance transferred from the old account is an item with a warning', () => {
  const lines = [
    ...header('Feb 02, 2031', 'Jan 30, 2031 to Feb 27, 2031'),
    'Your bill at a glance  Your bill explained',
    '• This bill includes a balance transfer for your Xfinity',
    'Previous balance  $0.00  services at your previous address.',
    'Payments  $0.00  • This page gives you a quick summary of your monthly',
    'Balance forward  $0.00',
    'Balance Transferred From:  Jan 31  $2.50',
    '0000000000000000',
    'Regular monthly charges  Page 3  $41.00',
    'One-time charges  Page 3  $0.00',
    'Taxes, fees and other charges  $0.00',
    'New charges  $43.50',
    'Amount due  $43.50',
    ...stub('Feb 20, 2031', '$43.50'),
    ...header('Feb 02, 2031', 'Jan 30, 2031 to Feb 27, 2031', '3 of 3'),
    'Balance transfer  $2.50',
    'Balance Transferred From:  Jan 31  $2.50',
    "Regular monthly charges  $41.00  What's included?",
    'Your Xfinity package  $41.00',
    'Internet: Example Speed  $41.00',
    'Equipment & services  $0.00',
    'One-time charges  $0.00',
    'Other charges  $0.00',
    'Internet Transfer Fee  Jan 30  $0.00',
    'Additional information',
  ];
  const { d } = run(lines);
  assert.equal(d.periodStart, '2031-01-30');
  assert.equal(d.total, 43.5);
  assert.deepEqual(d.items.map(it => [it.key, it.amount]), [['balance_transfer', 2.5], ['internet', 41]]);
  assert.equal(d.warnings.length, 1);
  assert.match(d.warnings[0], /Balance transfer/);
});

test('taxes, one-time charges and equipment are broken out from the detail page', () => {
  const lines = [
    ...header('Apr 12, 2031', 'Apr 17, 2031 to May 16, 2031'),
    'Previous balance  $60.00',
    'EFT Payment - thank you  Apr 08  -$60.00',
    'Balance forward  $0.00',
    'Regular monthly charges  Page 3  $55.00',
    'One-time charges  Page 3  $10.00',
    'Taxes, fees and other charges  $3.21',
    'New charges  $68.21',
    'Amount due  $68.21',
    ...stub('May 07, 2031', '$68.21'),
    ...header('Apr 12, 2031', 'Apr 17, 2031 to May 16, 2031', '3 of 3'),
    "Regular monthly charges  $55.00  What's included?",
    'My Xfinity plan  $55.00',
    'My Xfinity services  $60.00',
    'Internet: Example More  $60.00',
    'Discounts  -$20.00',
    'Automatic Payments Discount  -$20.00',
    'Equipment & services  $15.00',
    'xFi Gateway  $15.00',
    'One-time charges  $10.00',
    'Other charges  $10.00',
    'Late Fee  Apr 02  $10.00',
    'Taxes, fees and other charges  $3.21',
    'Regulatory Cost Recovery Fee  $2.00',
    'Example Utility Users Tax  $1.21',
    'Additional information',
  ];
  const { d } = run(lines);
  assert.equal(d.total, 68.21);
  assert.deepEqual(d.items.map(it => [it.key, it.amount]), [
    ['internet', 60], ['automatic_payments_discount', -20], ['equipment', 15],
    ['late_fee', 10], ['regulatory_cost_recovery_fee', 2], ['example_utility_users_tax', 1.21],
  ]);
  assert.equal(sumItems(d), d.total);
  assert.deepEqual(d.warnings, []);
});

test('when the detail page does not add up, falls back to the group / summary line', () => {
  const bill = detail => [
    ...header('Apr 12, 2031', 'Apr 17, 2031 to May 16, 2031'),
    'Balance forward  $0.00',
    'Regular monthly charges  Page 3  $55.00',
    'Taxes, fees and other charges  $1.50',
    'New charges  $56.50',
    ...stub(null),
    ...header('Apr 12, 2031', 'Apr 17, 2031 to May 16, 2031', '3 of 3'),
    "Regular monthly charges  $55.00  What's included?",
    ...detail,
    'Additional information',
  ];
  // 套餐下面的小项对不上：用套餐这一行
  let { d } = run(bill(['Your Xfinity package  $55.00', 'Internet: Example Speed  $50.00']));
  assert.deepEqual(d.items, [
    { key: 'internet', label: 'Your Xfinity package', amount: 55 },
    { key: 'taxes_fees', label: 'Taxes, fees and other charges', amount: 1.5 },
  ]);
  assert.equal(d.total, 56.5);
  assert.deepEqual(d.warnings, []);
  // 整个大项都对不上：用首页摘要那一行
  ({ d } = run(bill(['Internet: Example Speed  $50.00'])));
  assert.deepEqual(d.items[0], { key: 'internet', label: 'Internet (Regular monthly charges)', amount: 55 });
  assert.equal(d.total, 56.5);
  assert.deepEqual(d.warnings, []);
});

test('warns when items do not add up to New charges', () => {
  const lines = [
    ...header('Apr 12, 2031', 'Apr 17, 2031 to May 16, 2031'),
    'Balance forward  $0.00',
    'Regular monthly charges  Page 3  $55.00',
    'New charges  $57.00',
    ...stub(null),
  ];
  const { d } = run(lines);
  assert.equal(d.total, 57);
  assert.ok(d.warnings.some(w => /分项相加 \$55\.00/.test(w)));
});

test('single-space lines (OCR / other text extractors) still give dates and totals', () => {
  const lines = [
    'Account Number', ACCT, 'Billing Date', 'Mar 12, 2031', 'Services From', 'Mar 17, 2031 to Apr 16, 2031', 'Page', '1 of 3',
    'Thank you for choosing Xfinity.',
    'Your bill at a glance',
    'Previous balance $41.00',
    'EFT Payment - thank you Mar 08 -$41.00',
    'Balance forward $0.00',
    'Regular monthly charges Page 3 $41.00',
    'Taxes, fees and other charges $0.00',
    'New charges $41.00',
    'Amount due $41.00',
    'Your automatic payment on Apr 07, 2031, will include your',
    'COMCAST',
    "Regular monthly charges $41.00",
    'My Xfinity plan $41.00',
    'My Xfinity services $60.00',
    'Internet: Example More $60.00',
    'Discounts -$19.00',
    'Contract Discount -$12.00',
    'Includes a 12 month $12.00 Contract Discount that will end on Feb 28, 2032',
    'Automatic Payments Discount',
    'Including Paperless Billing',
    '-$7.00',
    'Additional information',
  ];
  const { ok, d } = run(lines);
  assert.equal(ok, true);
  assert.equal(d.statementDate, '2031-03-12');
  assert.equal(d.periodStart, '2031-03-17');
  assert.equal(d.periodEnd, '2031-04-16');
  assert.equal(d.dueDate, '2031-04-07');
  assert.equal(d.total, 41);
  assert.deepEqual(d.items.map(it => [it.key, it.amount]), [['internet', 60], ['contract_discount', -12], ['automatic_payments_discount', -7]]);
  assert.equal(d.accountLast4, '0000');
});

test('detect is strict', () => {
  assert.equal(detect(OLD_STYLE.join('\n')), true);
  assert.equal(detect(''), false);
  assert.equal(detect('Pacific Gas and Electric Company\nENERGY STATEMENT\nAccount No: 0000000000-0\nStatement Date: 01/05/2031\nTotal Amount Due $100.00'), false);
  assert.equal(detect('AT&T\nAccount number 000000000000\nBill period Jan 21 - Feb 20, 2031\nInternet $65.00\nWelcome! You switched from Xfinity.'), false);
  // 只是提到 Xfinity / Comcast 的广告或信件，不是账单
  assert.equal(detect('Upcoming price changes to Xfinity services\nThank you for trusting Xfinity. Comcast'), false);
});

test('detect: header and a summary row with an amount are both required; OCR-garbled header still counts', () => {
  // 信件 / 广告里出现 Billing Date、New charges 字样，但没有表头和金额
  assert.equal(detect('Upcoming price changes to Xfinity services\nBilling Date\nComcast\nNew charges may apply'), false);
  assert.equal(detect('Account Number  Billing D1te  Services From  Page\nThank you for choosing Xfinity.\nNew ch1rges  $41.00\nCOMCAST'), true);
});

// 扫描件走 OCR 时的样子（照 macOS Vision 的实际输出编的）：a 认成 o / 1 / ›，表头几格上下错位，
// 金额掉到下一行，逗号后没空格，明细前面多出图标认成的「•」「-」「+」
const OCR_STYLE = [
  'Account Number  Billing D1te  Services From  Page',
  `${ACCT} 1 of 3`,                                                    // 账号后面紧跟页码（单个空格）
  'xfinıty  Jun 29, 2031 to Jul 28, 2031',
  'Jul 01, 2031',                                                       // 账单日排到了服务周期后面
  'Thank you for choosing Xfinity.',
  'Your bill at a glonce  Your bill expl1ined',
  'Previous balance  $41.00',
  'Credit card payment - thonk you Jun 20  -$41.00',
  'Balonce forward  $0.00',
  'Partial charges  -$3.00  a result of a change made to your',
  'Page 3',
  'Regular monthly charges  Page 3  $41.00',
  '$0.00',
  'One-time charges  Page 3',
  'Taxes, fees and other charges  $0.00',
  'New ch1rges  $38.00',
  'Amount due  $38.00',
  'Your autom1tic payment on Jul 19, 2031, will include your',
  'xfınıty  Automatic payment  Jul 19,2031',
  'COMCAST',
  'Account Number  Billing D›te  Services From  Page',
  `${ACCT}  Jun 29, 2031 to Ju1 28, 2031  2 of 3`,                    // 这一页的日期认坏了，认不出就不算这一票
  'Ju1 01, 2O31',
  'Account Number  Billing Date  Services From  Page',
  `xfınıty  ${ACCT} Jul 01, 2031 Jun 29, 2031 to Jul 28, 2031 3of 3`,
  'Partial charges  -$3.00',
  '- Services removed  Jun 10 - Jun 28',
  '-$10.00  Please note: Credits for service you were billed',
  '+ Services added  Jun 10 - Jun 28',
  '$7.00  Please note: Charge for new service up to',
  "Regulor monthly charges  $41.00  What's included?",
  'My Xfinity plon  $41.00  Internet: Download as fast as 100 Mbps',
  'My Xtinity services  $60.00',
  'This shows a service is included in your package: •',
  'O Internet: Example More  $60.00',
  'Discounts  -$19.00',
  'Promotional Discount  -$12.00',
  'Automotic Payments Discount  -$7.00',
  'Including Paperless Billing',
  'Equipment & services  $0.00',
  'Additional information',
];

test('OCR output: garbled labels and dates, shuffled header, split amounts', () => {
  const { ok, d } = run(OCR_STYLE);
  assert.equal(ok, true);
  assert.equal(d.statementDate, '2031-07-01');   // 不能把服务周期的开始日当成账单日
  assert.equal(d.periodStart, '2031-06-29');
  assert.equal(d.periodEnd, '2031-07-28');
  assert.equal(d.dueDate, '2031-07-19');
  assert.equal(d.accountLast4, '0000');          // 不能把后面的页码「1」拼进账号
  assert.equal(d.total, 38);
  assert.deepEqual(d.items.map(it => [it.key, it.amount]), [
    ['partial_charges', -3], ['internet', 60], ['promotional_discount', -12], ['automatic_payments_discount', -7],
  ]);
  assert.equal(d.items[1].label, 'Internet: Example More');
  assert.equal(sumItems(d), d.total);
  assert.equal(d.warnings.length, 1);
  assert.match(d.warnings[0], /Partial charges/);
});

test('OCR final bill: credit line with a bullet and the amount on the next line still gives the period', () => {
  const lines = [
    'Account Number  Billing Date  Page', `${ACCT}  Oct 02, 2031  1 of 3`,
    'Your Xfinity services have been disconnected at your request.',
    'Your bill at a glance',
    'Previous balance  $70.00',
    'Credit card payment - thank you Sep 26  -$35.00  and all Comcast-owned equipment was returned.',
    'Balance forward  • If you provided an email address and we have not',
    '$35.00',
    'Partial charges  -$44.00  from the refunds team to select how',
    'Page 3',
    'Taxes, fees and other charges  $0.00',
    'New charges  -$44.00  within 15 days, will receive a physical prepaid card',
    'New balance  -$9.00',
    'COMCAST',
    'Account Number  Billing Date  Page', `${ACCT}  Oct 02, 2031  3of 3`,
    'Partial charges  -$44.00',
    '- Services removed  Sep 20 - Oct 21',
    '-$44.00  Please note: Credits for services you were billed',
    'Additional information',
  ];
  const { ok, d } = run(lines);
  assert.equal(ok, true);
  assert.equal(d.periodStart, '2031-09-20');
  assert.equal(d.periodEnd, '2031-10-21');
  assert.equal(d.total, -44);
  assert.deepEqual(d.items.map(it => [it.key, it.amount]), [['partial_charges', -44]]);
  assert.equal(d.dueDate, null);
});

test('summary: other balances, right-column sentences and "payment" text do not become items', () => {
  const lines = [
    ...header('Jan 24, 2031', 'Jan 29, 2031 to Feb 28, 2031'),
    'Your bill at a glance  Your bill explained',
    'Previous balance  $52.00',
    'Payment - thank you  Jan 20  -$30.00',
    'Remaining balance  $22.00',                              // 上期没付完的部分，不是本期费用
    '• Regular monthly charges have increased by $4.00',      // 右栏说明，带金额
    'Partial charges  Page 3  -$5.00',
    'payment and paperless billing.',                         // 右栏说明，有 payment 字样
    'Your new monthly rate will be $47.00',
    'Regular monthly charges  Page 3  $47.00',
    'Taxes, fees and other charges  $0.00  page 3.',
    'New charges  $42.00',
    'Amount due  $64.00',
    ...stub('Feb 19, 2031', '$64.00'),
  ];
  const { d } = run(lines);
  assert.equal(d.total, 42);
  assert.deepEqual(d.items.map(it => [it.key, it.amount]), [['partial_charges', -5], ['internet', 47]]);
  assert.equal(sumItems(d), d.total);
  assert.equal(d.warnings.length, 1);   // 只有 Partial charges 那一条
});

test('thousands separators, parenthesised credits, and an unknown summary category broken out from page 3', () => {
  const lines = [
    ...header('Jan 24, 2031', 'Jan 29, 2031 to Feb 28, 2031'),
    'Balance forward  $0.00',
    'Regular monthly charges  Page 3  $1,234.50',
    'Other charges & credits  Page 3  ($14.50)',
    'New charges  $1,220.00',
    ...stub(null),
    ...header('Jan 24, 2031', 'Jan 29, 2031 to Feb 28, 2031', '3 of 3'),
    "Regular monthly charges  $1,234.50  What's included?",
    'My Xfinity plan  $1,234.50',
    'My Xfinity services  $1,300.00',
    'Internet: Example Gig  $1,300.00',
    'Discounts  -$65.50',
    'Contract Discount  -$65.50',
    'Other charges & credits  ($14.50)',
    'Outage Credit  Jan 05  -$10.00',
    'Courtesy Credit  Jan 06  ($4.50)',
    'Additional information',
  ];
  const { d } = run(lines);
  assert.equal(d.total, 1220);
  assert.deepEqual(d.items.map(it => [it.key, it.amount]), [
    ['internet', 1300], ['contract_discount', -65.5], ['outage_credit', -10], ['courtesy_credit', -4.5],
  ]);
  assert.equal(d.items[2].label, 'Outage Credit (Jan 05)');
  assert.equal(sumItems(d), d.total);
  assert.equal(d.warnings.length, 1);
  assert.match(d.warnings[0], /Other charges & credits/);
});

test('scrambled columns: summary "New charges" merged into another line, the payment stub copy is used', () => {
  // 栏位打乱的取字结果（单个空格）：首页的 New charges 和 Taxes 挤在一行，金额掉到下一行；付款联上还有一份
  const lines = [
    'Account Number', ACCT, 'Billing Date', 'Aug 24, 2031', 'Services From', 'Aug 29, 2031 to Sep 28, 2031', 'Page', '1 of 3',
    'Thank you for choosing Xfinity.',
    'Your bill at a glance',
    'Previous balance $27.00',
    'Payments $0.00',
    'Past due balance $27.00',
    'Regular monthly charges Page 3 $33.00',
    'Taxes, fees and other charges New charges due Sep 15, 2031 $0.00',
    '$33.00',
    'Amount due $60.00',
    'Account number Past due balance $27.00',
    ACCT,
    'New charges due Sep 15, 2031 $33.00',
    'Total amount due $60.00',
    'COMCAST',
    'Regular monthly charges $33.00',
    'My Xfinity plan $33.00',
    'My Xfinity services $60.00',
    'Internet: Example More $60.00',
    "What's included?",
    'Discounts -$27.00',
    'Promotional Discount -$27.00',
    'Additional information',
  ];
  const { ok, d } = run(lines);
  assert.equal(ok, true);
  assert.equal(d.statementDate, '2031-08-24');
  assert.equal(d.total, 33);
  assert.equal(d.dueDate, '2031-09-15');
  assert.deepEqual(d.items.map(it => [it.key, it.amount]), [['internet', 60], ['promotional_discount', -27]]);
  assert.deepEqual(d.warnings, []);
});

test('page headers that disagree on the billing date: majority wins, with a warning', () => {
  const lines = [
    ...header('Jan 21, 2031', 'Jan 29, 2031 to Feb 28, 2031'),
    'Balance forward  $0.00',
    'Regular monthly charges  Page 3  $47.00',
    'New charges  $47.00',
    ...stub(null),
    ...header('Jan 24, 2031', 'Jan 29, 2031 to Feb 28, 2031', '2 of 3'),
    ...header('Jan 24, 2031', 'Jan 29, 2031 to Feb 28, 2031', '3 of 3'),
  ];
  const { d } = run(lines);
  assert.equal(d.statementDate, '2031-01-24');
  assert.ok(d.warnings.some(w => /账单日期不一致/.test(w)));
});
