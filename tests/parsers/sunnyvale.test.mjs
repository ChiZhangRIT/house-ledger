// City of Sunnyvale 账单解析器的测试。
// 下面的账单文字都是编的：只模仿真实账单按行取出来的结构（列之间两个空格），金额、日期、账号、姓名、地址全是假的。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as sv from '../../src/pdf/parsers/sunnyvale.js';

const run = text => { const lines = text.split('\n'); return sv.parse(lines, lines.join('\n')); };
const item = (d, key) => d.items.find(it => it.key === key)?.amount;
const itemsSum = d => Math.round(d.items.reduce((s, it) => s + it.amount, 0) * 100) / 100;

// 账户摘要（有用水图表的版本：图表的刻度、文字和摘要挤在同一行）
const summaryWithChart = ({ prev = '301.50', adj = '0.00', payment = 'Payment 01/05/2030, Thank You  301.50 CR', fwd = '0.00', current = '352.17', due = '352.17' } = {}) => `\
[Record*SNW0214A*0000*0000000000-0*Test Customer*Index]
CITY OF SUNNYVALE  Water Consumption
1 CCF (hundred cubic feet) = 748 GALLONS
UTILITY ACCOUNT SUMMARY FOR 0000000000-0
20
CUSTOMER NAME: TEST CUSTOMER
16
SERVICE ADDRESS: 100 EXAMPLE AV
12
Previous Balance  $  ${prev}  8
Adjustments and/or Penalties  ${adj}  4
${payment}  0
FEB  APR  JUN  AUG  OCT  DEC  CURR
Balance Forward
${fwd}  C u r r e n t Y e a r U s a g e - - - 2 0 2 0 U s a g e  T a r g e t U s a g e
Current Charges  ${current}
CURRENT CONSUMPTION:  12.00 CCF/61 DAYS (147.15 Gal/day)
Total Amount Due  $  ${due}  SAME PERIOD 2020:  0.00 CCF/0 DAYS
Target This Period:  APR Target  JUN Target:  AUG Target:
18.00 CCF  18.00 CCF  18.00 CCF  18.00 CCF`;

const detailA = `\
ACCOUNT DETAIL  AMOUNT
WATER SERVICE  SERVICE PERIOD  DAYS  PREVIOUS READ CURRENT READ
Domestic Meter #00000000  12/10/29 02/09/30  61  2000.00  2012.00
Service Chrg 1" Mtr  12/10/29 02/09/30  80.00
Water Consumption  10.00 CCF  x  6.00  =  60.00
2.00 CCF  x  7.00  =  14.00
Total Water Service  12.00 CCF  $  154.00
SEWER SERVICE  SERVICE PERIOD
Single-Family Sewer  12/11/29 02/10/30  x  120.10
Total Sewer Service  $  120.10
GARBAGE SERVICE  SERVICE PERIOD
43-Gal Cart Curb  12/11/29 02/10/30  78.07
Total Garbage Service  $  78.07`;

const stub = ({ total = '352.17', billDate = '02/14/2030', pastDue = 'Auto Pay on 03/06/2030' } = {}) => `\
TOTAL AMOUNT DUE:  $  ${total}
[1/1]
Account Number:  0000000000-0
Service Address:  100 Example Av
Bill Date:  ${billDate}
Payment Due:  Upon Presentation
Past Due After:  ${pastDue}
Total Amount Due:  $${total}
Amount Enclosed:  $
CITY OF SUNNYVALE - UTILITIES
TEST CUSTOMER
PO Box 0000
100 EXAMPLE AVE
000000000000000000000000000000`;

const page2 = `\
HOW TO REACH US
For billing questions; to start, stop or change water, sewer or garbage and recycling services; to schedule an on-call pick up for
PAST DUE BILLS
Your bill is past due if not paid within 25 days of the bill date and a five percent late payment penalty will be added to your account.
NOTICE TO CUSTOMERS
If you believe that you have been mischarged for water, sewer, or garbage collection service rendered, or that you have been charged`;

const billA = [summaryWithChart(), detailA, 'Total Current Charges  $  352.17', stub(), page2].join('\n');

test('detect：认 Sunnyvale 账单，不认别家', () => {
  assert.equal(sv.detect(billA), true);
  assert.equal(sv.id, 'sunnyvale');
  assert.equal(sv.category, 'water');
  // PG&E 账单里也可能出现城市名，但没有 Sunnyvale 账单的结构
  assert.equal(sv.detect('Pacific Gas and Electric Company\nENERGY STATEMENT\nAccount No: 0000000000-0\nUtility Users\' Tax (City of Sunnyvale)  1.23\nTotal Amount Due  $45.67'), false);
  assert.equal(sv.detect('AT&T\nAccount number 000000000000\nInternet 1000  $80.00\nTotal due  $80.00'), false);
  assert.equal(sv.detect('Xfinity\nComcast\nTotal amount due  $70.00\nSunnyvale, CA'), false);
  assert.equal(sv.detect(''), false);
  assert.equal(sv.detect(null), false);
});

test('一般账单：日期、周期、分项、用量、到期日', () => {
  const d = run(billA);
  assert.equal(d.provider, 'sunnyvale');
  assert.equal(d.statementDate, '2030-02-14');
  assert.equal(d.periodStart, '2029-12-10');   // 账单周期按水表的
  assert.equal(d.periodEnd, '2030-02-09');
  assert.equal(d.dueDate, '2030-03-06');       // 「Auto Pay on …」
  assert.equal(d.total, 352.17);
  assert.deepEqual(d.items, [
    { key: 'water', label: 'Water Service', amount: 154 },
    { key: 'sewer', label: 'Sewer Service', amount: 120.1 },
    { key: 'garbage', label: 'Garbage Service', amount: 78.07 },
  ]);
  assert.deepEqual(d.usage, [{ key: 'water', amount: 12, unit: 'CCF' }]);
  assert.equal(d.accountLast4, '0000');
  assert.deepEqual(d.warnings, []);
  assert.equal(itemsSum(d), d.total);
  // 说明页里的「bill date」字样排在前面时，也不能把账单日期弄丢
  assert.equal(run(page2 + '\n' + billA).statementDate, '2030-02-14');
});

test('7 月调价：同一分区拆两段，取分区合计；没开自动扣款时到期日取 Past Due After', () => {
  const text = `\
CITY OF SUNNYVALE
UTILITY ACCOUNT SUMMARY FOR 0000000000-0
CUSTOMER NAME: TEST CUSTOMER
SERVICE ADDRESS: 100 EXAMPLE AV
Previous Balance  $  0.00
Adjustments and/or Penalties  0.00
Payment  0.00
Balance Forward  0.00
Current Charges  389.40
Total Amount Due  $  389.40
ACCOUNT DETAIL  AMOUNT
WATER SERVICE  SERVICE PERIOD  DAYS  PREVIOUS READ CURRENT READ
Domestic Meter #00000000  06/20/30 08/19/30  60  2012.00  2030.00
Service Chrg 1" Mtr  06/20/30 07/01/30  14.00
Water Consumption  3.30 CCF  x  6.00  =  19.80
Service Chrg 1" Mtr  07/01/30 08/19/30  66.00
Water Consumption  6.70 CCF  x  6.40  =  42.88
8.00 CCF  x  7.50  =  60.00
Total Water Service  18.00 CCF  $  202.68
SEWER SERVICE  SERVICE PERIOD
Single-Family Sewer  06/21/30 07/01/30  x  20.00
Single-Family Sewer  07/01/30 08/15/30  x  95.12
Total Sewer Service  $  115.12
GARBAGE SERVICE  SERVICE PERIOD
43-Gal Cart Curb  06/21/30 07/01/30  13.10
43-Gal Cart Curb  07/01/30 08/15/30  58.50
Total Garbage Service  $  71.60
Total Current Charges  $  389.40
${stub({ total: '389.40', billDate: '08/23/2030', pastDue: '09/17/2030' })}`;
  const d = run(text);
  assert.equal(sv.detect(text), true);
  assert.equal(d.statementDate, '2030-08-23');
  assert.equal(d.periodStart, '2030-06-20');
  assert.equal(d.periodEnd, '2030-08-19');
  assert.equal(d.dueDate, '2030-09-17');
  assert.equal(d.total, 389.4);
  assert.equal(item(d, 'water'), 202.68);
  assert.equal(item(d, 'sewer'), 115.12);
  assert.equal(item(d, 'garbage'), 71.6);
  assert.deepEqual(d.usage, [{ key: 'water', amount: 18, unit: 'CCF' }]);
  assert.deepEqual(d.warnings, []);
});

test('上期余额、付款不算本期费用；有滞纳金时单列一项并计入合计', () => {
  const text = [
    summaryWithChart({ prev: '352.17', adj: '17.61', payment: 'Payment  0.00', fwd: '369.78', current: '352.17', due: '721.95' }),
    detailA, 'Total Current Charges  $  352.17', stub({ total: '721.95' }),
  ].join('\n');
  const d = run(text);
  assert.equal(d.total, 369.78);
  assert.equal(item(d, 'adjustments_penalties'), 17.61);
  assert.equal(itemsSum(d), d.total);
  assert.ok(d.warnings.some(w => w.includes('17.61')), '要提醒滞纳金');
  assert.ok(d.warnings.some(w => w.includes('369.78')), '要提醒有上期余额');
  assert.ok(!d.warnings.some(w => w.includes('摘要对不上')));
});

test('「10.00 CR」这种贷方调整算负数', () => {
  const text = [
    summaryWithChart({ prev: '352.17', adj: '10.00 CR', payment: 'Payment 03/01/2030, Thank You  352.17 CR', fwd: '10.00 CR', current: '352.17', due: '342.17' }),
    detailA, 'Total Current Charges  $  352.17', stub({ total: '342.17' }),
  ].join('\n');
  const d = run(text);
  assert.equal(item(d, 'adjustments_penalties'), -10);
  assert.equal(d.total, 342.17);
  assert.equal(itemsSum(d), d.total);
  assert.ok(!d.warnings.some(w => w.includes('摘要对不上')), d.warnings.join(' | '));
});

test('别的收费分区单独成一项；分项加起来对不上时给 warning', () => {
  const storm = `${detailA}
STORM DRAIN SERVICE  SERVICE PERIOD
Storm Drain Fee  12/11/29 02/10/30  5.25
Total Storm Drain Service  $  5.25`;
  const d = run([summaryWithChart({ current: '357.42', due: '357.42' }), storm, 'Total Current Charges  $  357.42', stub({ total: '357.42' })].join('\n'));
  assert.equal(item(d, 'storm_drain'), 5.25);
  assert.equal(d.total, 357.42);
  assert.equal(itemsSum(d), d.total);
  assert.deepEqual(d.warnings, []);

  // 垃圾分区的合计行丢了（比如 OCR 没认出来）：合计仍然取 Current Charges，但要提醒
  const broken = detailA.replace('Total Garbage Service  $  78.07', '');
  const d2 = run([summaryWithChart(), broken, 'Total Current Charges  $  352.17', stub()].join('\n'));
  assert.equal(d2.total, 352.17);
  assert.equal(item(d2, 'garbage'), undefined);
  assert.ok(d2.warnings.some(w => w.includes('78.07')), d2.warnings.join(' | '));
});

test('水表天数和日期对不上、用量和读数对不上时给 warning', () => {
  const text = billA
    .replace('Domestic Meter #00000000  12/10/29 02/09/30  61  2000.00  2012.00', 'Domestic Meter #00000000  12/10/29 02/08/30  61  2000.00  2013.00');
  const d = run(text);
  assert.equal(d.periodEnd, '2030-02-08');
  assert.ok(d.warnings.some(w => w.includes('天数')), d.warnings.join(' | '));
  assert.ok(d.warnings.some(w => w.includes('水表读数差 13')), d.warnings.join(' | '));
});

test('标签和数字分在不同行（别的取字工具 / OCR）也能读', () => {
  const text = `\
CITY OF SUNNYVALE
UTILITY ACCOUNT SUMMARY FOR 0000000000-0
Previous Balance
$
301.50
Adjustments and/or Penalties
0.00
Payment 01/05/2030, Thank You
301.50
CR
Balance Forward
0.00
Current Charges
352.17
Total Amount Due
$
352.17
CURRENT CONSUMPTION:
SAME PERIOD 2020:
12.00 CCF/61 DAYS (147.15 Gal/day)
0.00 CCF/0 DAYS
ACCOUNT DETAIL
WATER SERVICE SERVICE PERIOD DAYS
Domestic Meter #00000000 12/10/29 02/09/30 61
2000.00
Service Chrg 1" Mtr 12/10/29 02/09/30
80.00
Total Water Service 154.00
12.00 CCF
$
SEWER SERVICE SERVICE PERIOD
Total Sewer Service 120.10
$
GARBAGE SERVICE SERVICE PERIOD
Total Garbage Service 78.07
$
Total Current Charges 352.17
TOTAL AMOUNT DUE: 352.17
Bill Date:
02/14/2030
Payment Due:
Upon Presentation
Past Due After:
Auto Pay on 03/06/2030`;
  const d = run(text);
  assert.equal(d.statementDate, '2030-02-14');
  assert.equal(d.dueDate, '2030-03-06');
  assert.equal(d.periodStart, '2029-12-10');
  assert.equal(d.periodEnd, '2030-02-09');
  assert.equal(d.total, 352.17);
  assert.equal(item(d, 'water'), 154);
  assert.equal(item(d, 'sewer'), 120.1);
  assert.equal(item(d, 'garbage'), 78.07);
  assert.deepEqual(d.usage, [{ key: 'water', amount: 12, unit: 'CCF' }]);
  // 「Adjustments」后面那行是 0.00，不能把下面付款行的金额当成调整
  assert.equal(item(d, 'adjustments_penalties'), undefined);
  assert.deepEqual(d.warnings, []);
});

test('缺了关键内容时不报错，而是在 warnings 里说明', () => {
  const d = run('CITY OF SUNNYVALE\nUTILITY ACCOUNT SUMMARY FOR 0000000000-0\nsomething unreadable');
  assert.equal(d.statementDate, null);
  assert.equal(d.periodStart, null);
  assert.equal(d.total, 0);
  assert.deepEqual(d.items, []);
  assert.ok(d.warnings.length >= 3);
});

// ---- 下面是复核时补的：OCR 的行序错乱、少见的金额写法、额外的收费分区 ----

// OCR（macOS Vision 之类）取出来的样子：列之间的空格不一定是两个，合计金额会跑到上一行 / 下一行，
// 用水图表的「0.00 CCF/0 DAYS」会和「Total Amount Due」挤在同一行。数字都是编的。
const ocrSummary = `\
CITY OF SUNNYVALE  Water Consumption
1 CCF (hundred cubic feet) = 748 GALLONS
UTILITY ACCOUNT SUMMARY FOR 0000000000-0
CUSTOMER NAME: TEST CUSTOMER
SERVICE ADDRESS: 100 EXAMPLE AV
Previous Balance  $  301.50
Adjustments and/or Penalties  0.00
Payment 01/05/2030, Thank You  301.50 CR
Balance Forward  0.00  Current Year Usage  - 2020Usage  Target Usage
Current Charges  352.17  CURRENT CONSUMPTION: 12.00 CCF/61 DAYS (147.15 Gal/day)
Total Amount Due  SAME PERIOD 2020:  0.00 CCF/0 DAYS
$  352.17
Target This Period:  APR Target  JUN Target:  AUG Target:
18.00 CCF  18.00 CCF  18.00 CCF  18.00 CCF`;
const ocrStub = `\
TOTAL AMOUNT DUE:  352.17
Account Number:  0000000000-0
Bill Date:  02/14/2030
Payment Due:  Upon Presentation
Past Due After:
Auto Pay on 03/06/2030`;
const ocrBill = detail => [ocrSummary, detail, ocrStub].join('\n');
const ocrWater = `\
ACCOUNT DETAIL  AMOUNT
DAYS  PREVIOUS READ CURRENT READ
WATER SERVICE  SERVICE PERIOD
Domestic Meter #00000000  12/10/29 02/09/30  61  2000.00  2012.00
Service Chrg 1" Mtr  12/10/29 02/09/30  80.00
Water Consumption  10.00 CCF  6.00  60.00`;

test('OCR：合计金额在上一行、和别的行挤在一起、「Total Amount Due」行里有 CCF，都能对上', () => {
  const text = ocrBill(`${ocrWater}
2.00 CCF x
12.00 CCF  154.00
Total Water Service  7.00 = 14.00 5
SEWER SERVICE  SERVICE PERIOD
Single-Family Sewer  12/11/29 02/10/30
Total Sewer Service  120.10 $  120.10
GARBAGE SERVICE  SERVICE PERIOD
43-Gal Cart Curb  12/11/29 02/10/30  78.07
$  78.07
Total Garbage Service
$  352.17
Total Current Charges`);
  assert.equal(sv.detect(text), true);
  const d = run(text);
  assert.equal(d.statementDate, '2030-02-14');
  assert.equal(d.dueDate, '2030-03-06');
  assert.equal(d.periodStart, '2029-12-10');
  assert.equal(d.periodEnd, '2030-02-09');
  assert.equal(d.total, 352.17);
  // 水：同一行读到的 14.00 是阶梯那一行的，上一行的 154.00 才能和 Current Charges 对上
  assert.equal(item(d, 'water'), 154);
  assert.equal(item(d, 'sewer'), 120.1);
  // 垃圾：上一行是 78.07、下一行是 352.17（其实是 Total Current Charges 的），要挑对
  assert.equal(item(d, 'garbage'), 78.07);
  assert.deepEqual(d.usage, [{ key: 'water', amount: 12, unit: 'CCF' }]);   // 合计行上没有 CCF 时用水表读数差
  assert.equal(itemsSum(d), d.total);
  assert.deepEqual(d.warnings, []);   // 「0.00 CCF/0 DAYS」不能被当成 Total Amount Due
});

test('OCR：一个分区的金额完全没读到时用本期费用减去其他分区推算，并提醒', () => {
  const text = ocrBill(`${ocrWater}
2.00 CCF x  7.00 =  14.00
Total Water Service  12.00 CCF  154.00
SEWER SERVICE  SERVICE PERIOD
Single-Family Sewer  12/11/29 02/10/30  ZtStL
Total Sewer Service  $
GARBAGE SERVICE  SERVICE PERIOD
43-Gal Cart Curb  12/11/29 02/10/30  78.07
Total Garbage Service  $  82'96
Total Current Charges  $  352.17`);
  const d = run(text);
  assert.equal(d.total, 352.17);
  assert.equal(item(d, 'garbage'), 78.07);   // 合计行认坏了：按分区各行相加
  assert.equal(item(d, 'sewer'), 120.1);     // 一个数都没有：352.17 − 154.00 − 78.07
  assert.equal(itemsSum(d), d.total);
  assert.ok(d.warnings.some(w => w.includes('Sewer') && w.includes('推算')), d.warnings.join(' | '));
  assert.ok(d.warnings.some(w => w.includes('Garbage') && w.includes('相加')), d.warnings.join(' | '));

  // 两个分区都没金额：不瞎猜，只提醒
  const d2 = run(text.replace('43-Gal Cart Curb  12/11/29 02/10/30  78.07', '43-Gal Cart Curb  12/11/29 02/10/30  8768'));
  assert.equal(d2.total, 352.17);
  assert.equal(item(d2, 'sewer'), undefined);
  assert.equal(item(d2, 'garbage'), undefined);
  assert.ok(d2.warnings.some(w => w.includes('分项相加')), d2.warnings.join(' | '));
});

test('正常文字里合计行有金额时不拿逐行相加去凑：没认出来的分区只提醒，不会算进别的分项', () => {
  const text = [summaryWithChart({ current: '362.17', due: '362.17' }),
    detailA.replace('GARBAGE SERVICE  SERVICE PERIOD', 'MISC  SERVICE PERIOD\nSomething New  12/11/29 02/10/30  10.00\nTotal Misc  $  10.00\nGARBAGE SERVICE  SERVICE PERIOD'),
    'Total Current Charges  $  362.17', stub({ total: '362.17' })].join('\n');
  const d = run(text);
  assert.equal(d.total, 362.17);
  assert.equal(item(d, 'garbage'), 78.07);
  assert.ok(d.warnings.some(w => w.includes('差 $10.00')), d.warnings.join(' | '));
});

test('小于 1 的数没有前导 0（「.85」「.50 CCF」）', () => {
  const text = [
    summaryWithChart({ prev: '352.17', adj: '.85', payment: 'Payment  0.00', fwd: '353.02', current: '352.17', due: '705.19' }),
    detailA.replace('Total Water Service  12.00 CCF', 'Total Water Service  .50 CCF').replace('2000.00  2012.00', '2000.00  2000.00'),
    'Total Current Charges  $  352.17', stub({ total: '705.19' }),
  ].join('\n');
  const d = run(text);
  assert.equal(item(d, 'adjustments_penalties'), 0.85);
  assert.equal(d.total, 353.02);
  assert.deepEqual(d.usage, [{ key: 'water', amount: 0.5, unit: 'CCF' }]);   // 不是 50
  assert.ok(!d.warnings.some(w => w.includes('摘要对不上')), d.warnings.join(' | '));
});

test('贷方的「CR」被挤到下一行、或写成尾部负号，都算负数', () => {
  const split = `\
CITY OF SUNNYVALE
UTILITY ACCOUNT SUMMARY FOR 0000000000-0
Previous Balance
$
352.17
Adjustments and/or Penalties
10.00
CR
Payment 03/01/2030, Thank You
352.17
CR
Balance Forward
10.00
CR
Current Charges
352.17
Total Amount Due
$
342.17
${detailA}
Total Current Charges 352.17
${stub({ total: '342.17' })}`;
  const d = run(split);
  assert.equal(item(d, 'adjustments_penalties'), -10);
  assert.equal(d.total, 342.17);
  assert.ok(!d.warnings.some(w => w.includes('摘要对不上')), d.warnings.join(' | '));

  const minus = [
    summaryWithChart({ prev: '352.17', adj: '10.00-', payment: 'Payment 03/01/2030, Thank You  352.17-', fwd: '10.00-', current: '352.17', due: '342.17' }),
    detailA, 'Total Current Charges  $  352.17', stub({ total: '342.17' }),
  ].join('\n');
  const d2 = run(minus);
  assert.equal(item(d2, 'adjustments_penalties'), -10);
  assert.equal(d2.total, 342.17);
  assert.ok(!d2.warnings.some(w => w.includes('摘要对不上')), d2.warnings.join(' | '));
});

test('摘要核对：上期余额 + 调整 − 付款 ≠ Balance Forward 时提醒（调整金额可能读错）', () => {
  const text = [
    summaryWithChart({ prev: '352.17', adj: '17.61', payment: 'Payment 03/01/2030, Thank You  352.17 CR', fwd: '0.00', current: '352.17', due: '352.17' }),
    detailA, 'Total Current Charges  $  352.17', stub(),
  ].join('\n');
  const d = run(text);
  assert.ok(d.warnings.some(w => w.includes('Previous Balance') && w.includes('Balance Forward')), d.warnings.join(' | '));
});

test('税、补贴抵扣、再生水之类的分区各自成一项；千分位；跨页接着列明细', () => {
  const extra = `${detailA}
Total Utility Users Tax  $  12.00
RATE ASSISTANCE  SERVICE PERIOD
Low Income Credit  12/11/29 02/10/30  10.00 CR
Total Rate Assistance Credit  $  10.00 CR
RECYCLED WATER SERVICE  SERVICE PERIOD
Total Recycled Water Service  1.00 CCF  $  1,000.00`;
  const d = run([summaryWithChart({ current: '1,354.17', due: '1,354.17' }), extra, 'Total Current Charges  $  1,354.17', stub({ total: '1,354.17' })].join('\n'));
  assert.equal(d.total, 1354.17);
  assert.equal(item(d, 'utility_users_tax'), 12);
  assert.equal(item(d, 'rate_assistance_credit'), -10);
  assert.equal(item(d, 'recycled_water'), 1000);   // 不能因为有「recycl」就算成垃圾
  assert.equal(item(d, 'garbage'), 78.07);
  assert.deepEqual(d.usage, [{ key: 'water', amount: 12, unit: 'CCF' }]);
  assert.equal(itemsSum(d), d.total);
  assert.deepEqual(d.warnings, []);

  // 第一页放不下，缴费联和说明页夹在中间，第二页接着列分区和 Total Current Charges
  const twoPages = [summaryWithChart({ current: '357.42', due: '357.42' }), detailA, stub({ total: '357.42' }), page2,
    'CITY OF SUNNYVALE\nACCOUNT DETAIL (CONTINUED)  AMOUNT\nSTORM DRAIN SERVICE  SERVICE PERIOD\nStorm Drain Fee  12/11/29 02/10/30  5.25\nTotal Storm Drain Service  $  5.25\nTotal Current Charges  $  357.42'].join('\n');
  const d2 = run(twoPages);
  assert.equal(d2.total, 357.42);
  assert.equal(item(d2, 'storm_drain'), 5.25);
  assert.equal(d2.statementDate, '2030-02-14');
  assert.equal(itemsSum(d2), d2.total);
  assert.deepEqual(d2.warnings, []);
});

test('detect：OCR 压成单空格也认；别家账单（单空格版）不认', () => {
  assert.equal(sv.detect(billA.replace(/[ \t]+/g, ' ')), true);
  assert.equal(sv.detect('PG&E\nENERGY STATEMENT\nCity of Sunnyvale Utility Users Tax 1.23\nAccount Summary\nTotal Amount Due $45.67'), false);
  assert.equal(sv.detect('City of Sunnyvale\nWater Quality Report\nTotal Water Service area'), false);
});

test('分区特别多的怪文字也不会卡住', () => {
  const many = Array.from({ length: 40 }, (_, k) => `$  ${k + 1}.00\nTotal Extra ${String.fromCharCode(65 + (k % 26))}${String.fromCharCode(97 + Math.floor(k / 26))} Fee  ${k + 1}.00\n$  ${k + 2}.00`).join('\n');
  const t0 = Date.now();
  const d = run([summaryWithChart(), detailA, many, 'Total Current Charges  $  352.17', stub()].join('\n'));
  assert.ok(Date.now() - t0 < 1000);
  assert.equal(d.total, 352.17);
  assert.equal(d.items.length, 43);
  assert.ok(d.warnings.some(w => w.includes('分项相加')));
});
