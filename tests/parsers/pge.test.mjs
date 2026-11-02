// PG&E 解析器测试。数据全是编造的：只模仿真实账单按行取出来的结构（PDF 文字层 / OCR），金额、日期、账号、姓名、地址都是假的。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as pge from '../../src/pdf/parsers/pge.js';

const run = text => { const lines = text.split('\n'); return pge.parse(lines, lines.join('\n')); };
const item = (d, key) => d.items.find(it => it.key === key);
const itemsSum = d => Math.round(d.items.reduce((s, it) => s + it.amount, 0) * 100) / 100;
const usage = (d, key) => d.usage.find(u => u.key === key)?.amount;

const header = (stmt, due) => `\
Account No: 0000000000-9
ENERGY STATEMENT
Statement Date:  ${stmt}
www.pge.com/MyEnergy
Due Date:  ${due}`;

// —— 新版（PDF 有文字层）：摘要里的金额错位到上一行，有电费气候补贴，上期有没付清的 ——
const page1New = ({ delivery = '$150.10', total = '$192.64' } = {}) => `\
${header('03/09/2031', '03/30/2031')}
Service For:  Your Account Summary
.
Amount Due on Previous Statement  $120.00
PAT DOE
-100.00
SAM ROE  Payment(s) Received Since Last Statement
123 EXAMPLE ST  $20.00
Previous Unpaid Balance
ANYTOWN, CA 90000
Current PG&E Electric Delivery Charges  ${delivery}
...
Electric Adjustments  -30.00
Questions about your bill?  Silicon Valley Clean Energy Electric Generation Charges  40.20
.
Monday to Friday 7 a.m. to 7 p.m.  Current Gas Charges  12.34
Saturday 8 a.m. to 5 p.m.
Phone: 1-800-743-5000  Total Amount Due by 03/30/2031  ${total}
www.pge.com/MyEnergy www.pge.com/MyEnergy
Current charges include a discount of $30.00 for CA Climate Credit.
Monthly Billing History For 2/06 2031 electric $ 111.11 gas $ 22.22 For 3/09 2031 electric $ 190.30 gas $ 12.34
Account Number:  Due Date:  Total Amount Due:  Amount Enclosed:
0000000000-9 03/30/2031  ${total}
Page 1 of 6`;

const detailsNew = ({ deliveryTotal = '$150.10' } = {}) => `\
${header('03/09/2031', '03/30/2031')}
Rate Identification Number
Details of PG&E Electric Delivery Charges
01/31/2031 to 03/02/2031 (31 billing days)
Service For: 123 EXAMPLE ST
Service Agreement ID: 0000000000
Base Services Charge  31 days @ $0.50000  $15.50
Peak  50.000000 kWh @ $0.50000  25.00  www.pge.com/rin
Off Peak  300.000000 kWh @ $0.40000  120.00
Generation Credit  -20.00
Sunnyvale Utility Users' Tax (2.000%)  9.60  Meter #  0000000000
Total Usage  350.000000 kWh
Total PG&E Electric Delivery Charges  ${deliveryTotal}
Adjustments
California Climate Credit
-$30.00
Total Adjustments  -$30.00
Electric Usage This Period: 350.000000 kWh, 31 billing days
Page 3 of 6
${header('03/09/2031', '03/30/2031')}
Rate Identification Number
Details of Silicon Valley Clean Energy Electric
Generation Charges
01/31/2031 to 03/02/2031 (31 billing days)
Rate Schedule:  E-TOU-C
Generation - On Peak - Winter  50.000000 kWh @ $0.20000  $10.00
Generation - Off Peak - Winter  300.000000 kWh @ $0.10000  30.00  USCA-XXXX-0000-0000
Net Charges  40.00
Local Utility Users Tax  0.20
Total Silicon Valley Clean Energy  Total Usage  350.000000 kWh
Electric Generation Charges  $40.20
Page 4 of 6
${header('03/09/2031', '03/30/2031')}
Service Information
Details of Gas Charges
Meter #  00000000
02/01/2031 to 03/03/2031 (31 billing days)  Current Meter Reading  1,234
Service For: 123 EXAMPLE ST  Prior Meter Reading  1,224
Service Agreement ID: 0000000000  Difference  10
Total Usage  10.000000 Therms
Tier 1 Usage  10.000000Therms @ $1.20000  $12.00
Gas PPP Surcharge ($0.01000 /Therm)  0.10
Sunnyvale Utility Users' Tax (2.000%)  0.24
Total Gas Charges  $12.34
Gas Usage This Period: 10.000000 Therms, 31 billing days
Page 5 of 6
${header('03/09/2031', '03/30/2031')}
Important Messages (continued from page 1)  Your Electric Charges Breakdown (from page 2)
Transmission  20.00
Distribution  130.10
Total Electric Charges  $150.10
Page 6 of 6`;

// —— 旧版（OCR）：第一张账单（没有上期），金额错位，OCR 把 $ 认成 S、0 认成 O，有燃气气候补贴，CCA 换个名字 ——
const OLD_OCR = `\
Account No: 0000000000-9
ENERGY STATEMENT  Statement Date: 05/14/2030
PÇsl
www.pge.com/MyEnergy  Due Date: 06/04/2030
Service For:  Your Account Summary
S27.86
Pat Doe  Current PG&E Electric Delivery Charges
123 EXAMPLE ST  Peninsula Clean Energy Electric Generation Charges  8.12
3.91
ANYTOWN, CA 90000  Current Gas Charges
Gas Adjustments  –6.OO
Total Amount Due by 06/04/2030  S33.89
Questions about your bill?
Mon-Fri 7 a.m.-7 p.m.
Account Number:  Due Date:  Total Amount Due:
0000000000-9 06/04/2030  S33.89
Page 1 of 6
Account No: 0000000000-9
ENERGY STATEMENT  Statement Date:  05/14/2030
www.pge.com/MyEnergy  Due Date:  06/04/2030
Service Information
Details of PG&E Electric Delivery Charges
Meter #  0000000000
04/03/2030 - 04/29/2030 (27 billing days)  Total Usage  64.650000 kWh
Service For: 123 EXAMPLE ST  Baseline Territory
Peak  20.000000 kWh @ $0.50000  S10.00
Off Peak  17.86
44.650000 KWh @ $0.40000  Wildfire Fund Charge is also offset by an
Total PG&E Electric Delivery Charges  S27.86
Electric Usage This Period: 64.650000 kWh, 27 billing days
Page 3 of 6
Account No: 0000000000-9
ENERGY STATEMENT  Statement Date:  05/14/2030
Due Date:  06/04/2030
Service Information
Details of Peninsula Clean Energy Electric
Total Usage  64.650000 kWh
Generation Charges
04/03/2030 - 04/29/2030 (27 billing days)  please contact:
Net Charges 7.96  providing residents and businesses with
Local Utility Users Tax  0.16
Total Peninsula Clean Energy
Electric Generation Charges  S8.12 what PG&E would have charged for power, and
Page 4 of 6
Account No: 0000000000-9
ENERGY STATEMENT
Statement Date:  05/14/2030
Due Date:  06/04/2030
Details of Gas Charges  Service Information
Meter #  00000000
04/04/2030 - 04/30/2030 (27 billing days)  Current Meter Reading  5,120
Total Usage  2.000000 Therms
Total Gas Charges  S3.91
Adjustments
California Climate Credit
–S6.OO
Total Adjustments  –S6.00
Gas Usage This Period: 2.000000 Therms, 27 billing days
Page 5 of 6`;

test('detect：新版、旧版（OCR）都认；别家的账单和乱码不认', () => {
  assert.equal(pge.detect(page1New() + '\n' + detailsNew()), true);
  assert.equal(pge.detect(OLD_OCR), true);
  assert.equal(pge.detect('CITY OF SUNNYVALE\nUTILITY ACCOUNT SUMMARY FOR 0000000000-0\nWATER SERVICE\nTotal Amount Due  $  100.00'), false);
  assert.equal(pge.detect('AT&T\nIssue Date:  Dec 12, 2030\nAccount Number:  0000000000-0\nTotal services  $55.30'), false);
  assert.equal(pge.detect('Xfinity\nComcast\nStatement Date  Dec 12, 2030\nRegular monthly charges  $70.00'), false);
  assert.equal(pge.detect('%!"#$ *"\' !#  (\'9/!"-  $+$\'%\'#$  354  4'), false);
  assert.equal(pge.detect(''), false);
});

test('新版：日期、周期、分项（气候补贴并进电费输配）、用量、账号', () => {
  const d = run(page1New() + '\n' + detailsNew());
  assert.equal(d.provider, 'pge');
  assert.equal(d.statementDate, '2031-03-09');
  assert.equal(d.dueDate, '2031-03-30');
  assert.equal(d.periodStart, '2031-01-31');
  assert.equal(d.periodEnd, '2031-03-02');
  assert.equal(d.accountLast4, '0000');   // 「-9」是校验位，不算
  assert.equal(item(d, 'electric_delivery').amount, 120.10);
  assert.match(item(d, 'electric_delivery').label, /PG&E Electric Delivery.*-\$30\.00/);
  assert.equal(item(d, 'electric_generation').amount, 40.20);
  assert.equal(item(d, 'electric_generation').label, 'Silicon Valley Clean Energy Electric Generation');
  assert.equal(item(d, 'gas').amount, 12.34);
  assert.equal(d.total, 172.64);            // 不含上期未付的 20.00
  assert.equal(itemsSum(d), d.total);
  assert.equal(usage(d, 'electricity'), 350);
  assert.equal(usage(d, 'gas'), 10);
  assert.equal(d.usage.find(u => u.key === 'gas').unit, 'therm');
  assert.deepEqual(d.warnings, []);
});

test('旧版 OCR：S 当 $、O 当 0、长破折号、金额错位、第一张账单、燃气补贴', () => {
  const d = run(OLD_OCR);
  assert.equal(d.statementDate, '2030-05-14');
  assert.equal(d.dueDate, '2030-06-04');
  assert.equal(d.periodStart, '2030-04-03');
  assert.equal(d.periodEnd, '2030-04-29');
  assert.equal(item(d, 'electric_delivery').amount, 27.86);
  assert.equal(item(d, 'electric_generation').amount, 8.12);
  assert.equal(item(d, 'electric_generation').label, 'Peninsula Clean Energy Electric Generation');
  assert.equal(item(d, 'gas').amount, -2.09);
  assert.match(item(d, 'gas').label, /incl\. adjustments -\$6\.00/);
  assert.equal(d.total, 33.89);
  assert.equal(itemsSum(d), d.total);
  assert.equal(usage(d, 'electricity'), 64.65);
  assert.equal(usage(d, 'gas'), 2);
  assert.deepEqual(d.warnings, []);
});

test('只有第一页（摘要）也能出分项；只有明细页也能出分项', () => {
  const p1 = run(page1New());
  assert.deepEqual(p1.items.map(i => i.amount), [120.10, 40.20, 12.34]);
  assert.equal(p1.total, 172.64);
  assert.ok(p1.warnings.some(w => /服务周期/.test(w)));

  // OCR 版第一页：金额错位到上一行、S 当 $
  const ocr1 = run(OLD_OCR.split('Page 1 of 6')[0]);
  assert.deepEqual(ocr1.items.map(i => i.amount), [27.86, 8.12, -2.09]);
  assert.equal(ocr1.total, 33.89);
  assert.ok(!ocr1.warnings.some(w => /对不上|没读到/.test(w)));

  const det = run(detailsNew());
  assert.deepEqual(det.items.map(i => i.amount), [120.10, 40.20, 12.34]);
  assert.equal(det.periodStart, '2031-01-31');
  assert.ok(det.warnings.some(w => /Account Summary/.test(w)));
});

test('明细页和摘要对不上时，用能凑出应付总额的那个，并提醒', () => {
  // 明细页的电费输配被认错成 105.10，摘要是对的 150.10
  const d = run(page1New() + '\n' + detailsNew({ deliveryTotal: '$105.10' }).replace('Total Electric Charges  $150.10', 'Total Electric Charges  $105.10'));
  assert.equal(item(d, 'electric_delivery').amount, 120.10);
  assert.equal(d.total, 172.64);
  assert.ok(d.warnings.some(w => /明细页写 105\.1，摘要写 150\.1；用了后者/.test(w)));
});

test('分项合计和应付总额对不上时加 warning', () => {
  const d = run(page1New({ total: '$200.00' }) + '\n' + detailsNew());
  assert.equal(d.total, 172.64);
  assert.equal(itemsSum(d), d.total);
  assert.ok(d.warnings.some(w => /对不上/.test(w)));
});

test('换过电表（好几行 Total Usage，其中一行是 0）：用量取整期合计', () => {
  const text = (page1New() + '\n' + detailsNew()).replace(
    'Total Usage  350.000000 kWh\n',
    'Meter #  0000000001\nTotal Usage  0.000000 kWh\nMeter #  0000000000\nTotal Usage  350.000000 kWh\n');
  assert.equal(usage(run(text), 'electricity'), 350);
  // 没有「Electric Usage This Period」时取最大的 Total Usage
  const noPeriod = text.replace(/Electric Usage This Period:.*\n/, '');
  assert.equal(usage(run(noPeriod), 'electricity'), 350);
});

test('摘要里出现没认识的收费项目时提醒用户', () => {
  const d = run(page1New().replace('Current Gas Charges  12.34', 'Current Gas Charges  12.34\nLate Payment Charge  5.00') + '\n' + detailsNew());
  assert.ok(d.warnings.some(w => /没认出来/.test(w)));
});

test('服务周期天数和日期对不上时提醒（OCR 认错日期）', () => {
  const text = (page1New() + '\n' + detailsNew()).replace('01/31/2031 to 03/02/2031 (31 billing days)', '01/31/2031 to 03/08/2031 (31 billing days)');
  const d = run(text);
  assert.equal(d.periodEnd, '2031-03-08');
  assert.ok(d.warnings.some(w => /31 天对不上/.test(w)));
});

// —— 下面这些是复核时加的「想办法让它出错」的情形，数据同样全是编的 ——
const full = (p1 = {}, det = {}) => page1New(p1) + '\n' + detailsNew(det);

test('千分位：文字层「$1,150.10」，OCR 把千分位认成「1.150.10」或「1,150,10」', () => {
  const big = full({ delivery: '$1,150.10', total: '$1,192.64' }, { deliveryTotal: '$1,150.10' }).replace('Total Electric Charges  $150.10', 'Total Electric Charges  $1,150.10');
  const d = run(big);
  assert.equal(item(d, 'electric_delivery').amount, 1120.10);
  assert.equal(d.total, 1172.64);
  assert.deepEqual(d.warnings, []);
  const ocr = run(big.replace('Electric Delivery Charges  $1,150.10', 'Electric Delivery Charges  S1.150.10')
    .replace('Total PG&E Electric Delivery Charges  $1,150.10', 'Total PG&E Electric Delivery Charges  $1,150,10')
    .replaceAll('$1,192.64', 'S1.192.64'));
  assert.equal(item(ocr, 'electric_delivery').amount, 1120.10);
  assert.equal(ocr.total, 1172.64);
  assert.deepEqual(ocr.warnings, []);
});

test('上期多付了（余额是负数）、本期应付是负数（账户有余额）', () => {
  const text = full({ total: '-$7.36' })
    .replace('Amount Due on Previous Statement  $120.00', 'Amount Due on Previous Statement  $120.00')
    .replace('-100.00', '-300.00')
    .replace('123 EXAMPLE ST  $20.00', '123 EXAMPLE ST  -$180.00');
  const d = run(text);
  assert.equal(d.total, 172.64);              // 本期新费用不受上期余额影响
  assert.deepEqual(d.warnings, []);           // -7.36 − (−180.00) = 172.64
});

test('明细里的 Total Adjustments 因为版面错位排到了发电部分后面：不能和摘要的 Electric Adjustments 算两次', () => {
  const det = detailsNew().replace('Adjustments\nCalifornia Climate Credit\n-$30.00\nTotal Adjustments  -$30.00\n', '')
    .replace('Generation Charges\n01/31/2031', 'Generation Charges\nTotal Adjustments  -$30.00\n01/31/2031');
  const d = run(page1New() + '\n' + det);
  assert.equal(item(d, 'electric_delivery').amount, 120.10);
  assert.equal(item(d, 'electric_generation').amount, 40.20);
  assert.equal(d.total, 172.64);
  assert.deepEqual(d.warnings, []);
});

test('真正属于发电部分的调整项（摘要里没有 Electric Adjustments）并进发电', () => {
  const p1 = page1New({ total: '$212.64' }).replace('Electric Adjustments  -30.00\n', '');
  const det = detailsNew().replace('Adjustments\nCalifornia Climate Credit\n-$30.00\nTotal Adjustments  -$30.00\n', '')
    .replace('Electric Generation Charges  $40.20\n', 'Electric Generation Charges  $40.20\nAdjustments\nSVCE Bill Credit\nTotal Adjustments  -$10.00\n')
    .replace('Current charges include a discount of $30.00 for CA Climate Credit.', '');
  const d = run(p1.replace('Current charges include a discount of $30.00 for CA Climate Credit.', '') + '\n' + det);
  assert.equal(item(d, 'electric_delivery').amount, 150.10);
  assert.equal(item(d, 'electric_generation').amount, 30.20);
  assert.match(item(d, 'electric_generation').label, /incl\. adjustments -\$10\.00/);
  assert.equal(d.total, 192.64);
  assert.deepEqual(d.warnings, []);
});

test('OCR 丢了负号：付款、调整项', () => {
  // 付款「-100.00」认成「100.00」：照样当付款
  const d1 = run(full().replace('\n-100.00\n', '\n100.00\n'));
  assert.equal(d1.total, 172.64);
  assert.deepEqual(d1.warnings, []);
  // 只有第一页、摘要的 Electric Adjustments 丢了负号：反过来才凑得上，用反过来的并提醒
  const d2 = run(page1New().replace('Electric Adjustments  -30.00', 'Electric Adjustments  30.00'));
  assert.equal(item(d2, 'electric_delivery').amount, 120.10);
  assert.equal(d2.total, 172.64);
  assert.ok(d2.warnings.some(w => /正负号/.test(w)));
  // 有明细页时，摘要丢了负号就用明细的 -$30.00
  const d3 = run(full().replace('Electric Adjustments  -30.00', 'Electric Adjustments  30.00'));
  assert.equal(d3.total, 172.64);
  assert.ok(d3.warnings.some(w => /摘要写 30，明细页写 -30；用了后者/.test(w)));
});

test('应付总额：标签那行没有金额时用付款单上的；两处不一致时用凑得上的那个', () => {
  const d1 = run(full().replace('Total Amount Due by 03/30/2031  $192.64', 'Total Amount Due by 03/30/2031'));
  assert.equal(d1.total, 172.64);
  assert.deepEqual(d1.warnings, []);
  // 摘要里的应付总额被认错成 792.64，付款单上是对的
  const d2 = run(full().replace('Total Amount Due by 03/30/2031  $192.64', 'Total Amount Due by 03/30/2031  $792.64'));
  assert.equal(d2.total, 172.64);
  assert.ok(d2.warnings.some(w => /摘要写 792\.64、付款单写 192\.64，用了付款单的/.test(w)));
  assert.ok(!d2.warnings.some(w => /对不上，请核对/.test(w)));
});

test('OCR 日期里的 l/I/O、用量里的 O；没认出「Your Account Summary」也照样读摘要', () => {
  const text = full().replaceAll('Statement Date:  03/09/2031', 'Statement Date:  O3/O9/2O31')
    .replace('01/31/2031 to 03/02/2031 (31 billing days)', '0l/3l/2031 to 03/02/2031 (3l billing days)')
    .replace('Electric Usage This Period: 350.000000 kWh', 'Electric Usage This Period: 35O.000000 kWh')
    .replace('Service For:  Your Account Summary', 'Service For:  Yovr Accovnt Sumrnary');
  const d = run(text);
  assert.equal(d.statementDate, '2031-03-09');
  assert.equal(d.periodStart, '2031-01-31');
  assert.equal(usage(d, 'electricity'), 350);
  assert.equal(d.total, 172.64);
  assert.ok(!d.warnings.some(w => /Account Summary|账单日期/.test(w)), d.warnings.join(' / '));
});

test('明细跨页：Details 和 Total 中间隔着分页和下一页的页眉', () => {
  const det = detailsNew().replace('Generation Credit  -20.00\n',
    `Generation Credit  -20.00\nPage 2 of 6\n${header('03/09/2031', '03/30/2031')}\nDetails of PG&E Electric Delivery Charges (continued)\n`);
  const d = run(page1New() + '\n' + det);
  assert.equal(item(d, 'electric_delivery').amount, 120.10);
  assert.equal(d.periodStart, '2031-01-31');
  assert.equal(d.total, 172.64);
  assert.deepEqual(d.warnings, []);
});

test('detect：提到 PG&E 的别家账单、CCA 的通知都不认', () => {
  assert.equal(pge.detect('CITY OF SUNNYVALE\nUTILITY BILL\nPG&E customers may qualify for rebates\nWater  Garbage  Sewer\nTotal Current Charges  $120.00'), false);
  assert.equal(pge.detect('Silicon Valley Clean Energy\nYour Electric Generation Charges appear on your PG&E bill\nwww.svcleanenergy.org'), false);
  assert.equal(pge.detect('Comcast Xfinity\nENERGY STATEMENT is not available\nInternet  $70.00'), false);
});

test('说明文字里的「details of your electric …」不会被当成发电部分的标题', () => {
  const det = detailsNew().replace('Rate Identification Number\nDetails of PG&E Electric Delivery Charges',
    'Visit www.pge.com for details of your Electric usage and rates\nRate Identification Number\nDetails of PG&E Electric Delivery Charges');
  const d = run(page1New() + '\n' + det);
  assert.equal(item(d, 'electric_generation').label, 'Silicon Valley Clean Energy Electric Generation');
  assert.equal(d.total, 172.64);
  assert.deepEqual(d.warnings, []);
});

test('没有 CCA 的账单（假想的版面）：电费全算在电费输配里并提醒；应付总额凑不上时保留首选读法，不硬凑', () => {
  const bundled = total => page1New({ total }).replace('Current PG&E Electric Delivery Charges  $150.10', 'Current PG&E Electric Charges  $190.30')
    .replace('Questions about your bill?  Silicon Valley Clean Energy Electric Generation Charges  40.20', 'Questions about your bill?')
    + '\n' + detailsNew().replace('Details of PG&E Electric Delivery Charges', 'Details of PG&E Electric Charges')
      .replace('Total PG&E Electric Delivery Charges  $150.10', 'Total PG&E Electric Charges  $190.30')
      .replace(/Details of Silicon Valley[\s\S]*?Page 4 of 6\n/, '')
      .replace('Total Electric Charges  $150.10', 'Total Electric Charges  $190.30');
  const d = run(bundled('$192.64'));
  assert.deepEqual(d.items.map(i => [i.key, i.amount]), [['electric_delivery', 160.30], ['gas', 12.34]]);
  assert.equal(d.total, 172.64);
  assert.deepEqual(d.warnings, ['这张账单没有单独的发电（CCA）部分，电费全部算在了电费输配里，请核对']);
  // 应付总额差了 30：不能靠「把补贴的正负号反过来 + 再加一笔」之类硬凑
  const bad = run(bundled('$222.64'));
  assert.deepEqual(bad.items.map(i => [i.key, i.amount]), [['electric_delivery', 160.30], ['gas', 12.34]]);
  assert.ok(bad.warnings.some(w => /202\.64 对不上/.test(w)));
  assert.ok(!bad.warnings.some(w => /用了后者/.test(w)));
});
