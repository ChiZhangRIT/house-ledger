import test from 'node:test';
import assert from 'node:assert/strict';
import { blankState } from '../src/core/store.js';
import { scheduledPeriods, rentDates, validateRentPeriod, validateSchedules, rentTrackingStart } from '../src/core/rentPeriods.js';
import { buildRentLedger } from '../src/core/rent.js';

function fixture() {
  const s = blankState(); s.settings = { ledgerStart: '2026-10', graceDays: 0 };
  for (const [id, cycleDay, dueDay] of [['a', 1, 1], ['b', 16, 10]]) s.data.residents[id] = {
    id, name: id, moveIn: '2026-01-01', rent: [{ from: '2026-01-01', amount: 1000 }],
    rentSchedules: [{ from: '2026-01-01', cycleDay, dueDay, dueMonthOffset: 0 }],
  };
  return s;
}

test('同一房屋自然月与16日起算并存，到期日和覆盖区间独立', () => {
  const s = fixture();
  const a = scheduledPeriods(s, s.data.residents.a, '2026-10-18')[0];
  const b = scheduledPeriods(s, s.data.residents.b, '2026-10-18')[0];
  assert.deepEqual([a.periodStart, a.periodEnd, a.dueDate], ['2026-10-01', '2026-10-31', '2026-10-01']);
  assert.deepEqual([b.periodStart, b.periodEnd, b.dueDate], ['2026-10-16', '2026-11-15', '2026-10-10']);
});

test('跨年、31日起算与闰年短月钳到月底，下一期仍回到约定日期', () => {
  const s = fixture(); s.settings.ledgerStart = '2023-12';
  const r = s.data.residents.a; r.moveIn = '2023-12-31';
  r.rentSchedules = [{ from: '2023-12-31', cycleDay: 31, dueDay: 31, dueMonthOffset: -1 }];
  const rows = scheduledPeriods(s, r, '2024-03-15');
  assert.deepEqual(rows.slice(0, 4).map(x => [x.periodStart, x.periodEnd, x.dueDate]), [
    ['2023-12-31','2024-01-30','2023-11-30'], ['2024-01-31','2024-02-28','2023-12-31'],
    ['2024-02-29','2024-03-30','2024-01-31'], ['2024-03-31','2024-04-29','2024-02-29'],
  ]);
});

test('首末期按实际居住截短，已保存租期不随约定改变', () => {
  const s = fixture(), r = s.data.residents.b;
  r.moveIn = '2026-10-20'; r.moveOut = '2026-11-10';
  const first = scheduledPeriods(s, r, '2026-11-01')[0];
  assert.deepEqual([first.periodStart, first.periodEnd], ['2026-10-20','2026-11-09']);
  s.data.rents[first.id] = { ...first, amount: 700 };
  const previous = structuredClone(r);
  r.rentSchedules[0].cycleDay = 1;
  assert.equal(validateSchedules(s, r, previous), 'frozen');
  assert.equal(scheduledPeriods(s, r, '2026-11-01').some(x => x.periodStart <= first.periodEnd), false);
});

test('旧历史日期保留为识别信息，不擅自当作覆盖日期；同月不同租期允许，重叠拒绝', () => {
  assert.equal(rentDates({ periodStart: '2026-09-16', paid: true }).periodStart, null);
  const s = fixture();
  const rec = { id: 'x', residentId: 'a', history: true, datesConfirmed: true, periodStart:'2026-09-01', periodEnd:'2026-09-15', dueDate:'2026-08-30' };
  s.data.rents.x = rec;
  assert.equal(validateRentPeriod(s, { ...rec, id:'y', periodStart:'2026-09-16', periodEnd:'2026-09-30' }), null);
  assert.equal(validateRentPeriod(s, { ...rec, id:'y', periodStart:'2026-09-15', periodEnd:'2026-09-30' }), 'overlap');
});

test('提前付款指向未来租期，不冲抵较早欠租；分次与退款只改变选定租期', () => {
  const s = fixture(), rows = scheduledPeriods(s, s.data.residents.a, '2026-11-03');
  const october = rows[0], november = rows[1];
  for (const x of [october, november]) s.data.rents[x.id] = { ...x, amount:1000 };
  for (const [id, amount, date] of [['p1',600,'2026-10-20'],['p2',500,'2026-10-25'],['refund',-200,'2026-10-26']]) {
    s.data.payments[id] = { id, residentId:'a', purpose:'rent', rentId:november.id, amount, date };
  }
  const p = buildRentLedger(s, '2026-11-03').people.a;
  assert.equal(p.debits.find(d=>d.period===october.periodStart).remaining, 100000);
  assert.equal(p.debits.find(d=>d.period===november.periodStart).remaining, 10000);
  assert.equal(p.outstanding, 1100);
});

test('旧收款不按到账月份猜租期；未设置约定不会捏造应收和逾期', () => {
  const s = fixture(); s.data.payments.p = { id:'p',residentId:'a',purpose:'rent',date:'2026-10-10',amount:1000 };
  const p = buildRentLedger(s,'2026-10-20').people.a;
  assert.equal(p.unassignedPayments.length, 1);
  assert.equal(p.outstanding,1000);
  delete s.data.residents.b.rentSchedules;
  const b = buildRentLedger(s,'2026-10-20').people.b;
  assert.equal(b.scheduleMissing,true); assert.equal(b.overdue,0);
});

test('短期应收按实际覆盖天数计算，已确认金额不被月租修改重算', async () => {
  const { rentPeriodsFor } = await import('../src/core/rent.js');
  const s = fixture(), r = s.data.residents.b;
  r.moveIn = '2026-10-20'; r.moveOut = '2026-11-10';
  const first = rentPeriodsFor(s, 'b', '2026-11-03')[0];
  assert.equal(first.amount, Math.round(1000 * 21 / 31 * 100) / 100);
  s.data.rents[first.id] = { ...first, amount: 700 };
  r.rent[0].amount = 5000;
  assert.equal(rentPeriodsFor(s, 'b', '2026-11-03')[0].amount, 700);
});

test('新约定从已确认租期后生效，前后不重叠；自定义租期不能重复自动应收', () => {
  const s = fixture(), r = s.data.residents.b, previous = structuredClone(r);
  const first = scheduledPeriods(s, r, '2026-10-20')[0]; s.data.rents[first.id] = { ...first, amount: 1000 };
  r.rentSchedules.push({ from: '2026-11-16', cycleDay: 1, dueDay: 16, dueMonthOffset: 0 });
  assert.equal(validateSchedules(s, r, previous), null);
  const next = scheduledPeriods(s, r, '2026-11-20')[0];
  assert.deepEqual([next.periodStart, next.periodEnd, next.dueDate], ['2026-11-16', '2026-11-30', '2026-11-16']);
  assert.equal(validateRentPeriod(s, { ...next, id: 'duplicate' }), 'overlap');
  assert.equal(validateRentPeriod(s, { ...first, periodStart: '2026-09-16' }), 'beforeLedger');
});

test('调整与退款留在指定租期，旧调整不再用全屋起算日猜归属', () => {
  const s = fixture();
  const [oct, nov] = scheduledPeriods(s, s.data.residents.a, '2026-11-03');
  for (const row of [oct, nov]) s.data.rents[row.id] = { ...row, amount: 1000 };
  s.data.adjustments.discount = { id:'discount', purpose:'rent', residentId:'a', rentId:nov.id, amount:-100 };
  s.data.adjustments.legacy = { id:'legacy', purpose:'rent', residentId:'a', collectPeriod:'2026-10', amount:500 };
  s.data.payments.p = { id:'p',purpose:'rent',residentId:'a',rentId:nov.id,date:'2026-10-25',amount:900 };
  const p = buildRentLedger(s,'2026-11-03').people.a;
  assert.equal(p.debits.find(d=>d.rentId===nov.id).remaining,0);
  assert.equal(p.debits.find(d=>d.rentId===oct.id).remaining,100000);
  assert.equal(p.unassignedAdjustments.length,1);
});

test('日期不全的历史记录、完整租期、收款关联与批注可经备份同步及误删恢复', async () => {
  const { normalizeState, mergeStates, deletedRecord, restoredRecord } = await import('../src/core/store.js');
  const s = fixture(), first = scheduledPeriods(s,s.data.residents.a,'2026-10-20')[0];
  s.data.rents[first.id] = { ...first, amount:1000,updatedAt:10 };
  s.data.rents.old = { id:'old',residentId:'a',history:true,datesConfirmed:true,legacyDate:'2026-09-16',periodStart:null,periodEnd:null,dueDate:null,receivedAmount:0,paid:true,updatedAt:10 };
  s.data.comments.note = { id:'note',target:{collection:'rents',id:'old'},comments:[{text:'保留备注'}],updatedAt:10 };
  s.data.payments.p = { id:'p',purpose:'rent',residentId:'a',rentId:first.id,date:'2026-10-25',amount:500,updatedAt:10 };
  const reload = normalizeState(JSON.parse(JSON.stringify(s)));
  assert.equal(reload.data.rents.old.receivedAmount,0);
  assert.equal(reload.data.rents.old.periodStart,null);
  assert.equal(reload.data.residents.a.rentSchedules[0].cycleDay,1);
  assert.equal(mergeStates(blankState(),reload).data.payments.p.rentId,first.id);
  const removed = deletedRecord(reload.data.rents.old,20);
  assert.equal(restoredRecord('rents',removed).legacyDate,'2026-09-16');
  assert.equal(reload.data.comments.note.target.id,'old');
});

test('首期跨月截短时，保留常规租期的交租月份，不随实际入住日后移', () => {
  const s = fixture(); s.settings.ledgerStart='2026-01';
  const r = s.data.residents.b;
  const first = scheduledPeriods(s,r,'2026-01-10')[0];
  assert.deepEqual([first.periodStart,first.periodEnd,first.dueDate],['2026-01-01','2026-01-15','2025-12-10']);
});

test('10月1日入住：9月15日交首期，10月15日交10月16日至11月15日，保存后不重算旧日期', () => {
  const s = blankState();
  const r = s.data.residents.r = { id: 'r', name: 'Test', moveIn: '2022-10-01', rentTrackingStart: '2022-10-01',
    rent: [{ from: '2022-10-01', amount: 1000 }],
    rentSchedules: [{ from: '2022-09-01', cycleDay: 16, dueDay: 15, dueMonthOffset: 0 }] };
  const rows = scheduledPeriods(s, r, '2022-10-01', 1);
  assert.deepEqual(rows.slice(0, 2).map(x => [x.dueDate, x.periodStart, x.periodEnd]), [
    ['2022-09-15', '2022-10-01', '2022-10-15'],
    ['2022-10-15', '2022-10-16', '2022-11-15'],
  ]);
  s.data.rents[rows[0].id] = { ...rows[0], dueDate: '2022-10-15', amount: 500 };
  assert.equal(buildRentLedger(s, '2022-10-20').people.r.items.find(x => x.rentId === rows[0].id).due, '2022-10-15');
  assert.equal(scheduledPeriods(s, r, '2022-10-01', 1)[0].periodStart, '2022-10-16');
});

test('每位住户分别按完整日期开始跟踪，跨月租期不受全屋月份限制', () => {
  const s = fixture();
  s.data.residents.a.rentTrackingStart = '2026-10-01';
  s.data.residents.b.rentTrackingStart = '2026-09-16';
  const a = scheduledPeriods(s, s.data.residents.a, '2026-10-18')[0];
  const b = scheduledPeriods(s, s.data.residents.b, '2026-10-18')[0];
  assert.deepEqual([a.periodStart, b.periodStart, b.periodEnd], ['2026-10-01', '2026-09-16', '2026-10-15']);
  delete s.settings.ledgerStart;
  assert.equal(buildRentLedger(s, '2026-10-18').people.a.balance, 1000);
  assert.equal(buildRentLedger(s, '2026-10-18').people.b.balance, 2000);
  const rec = { id: 'custom', residentId: 'b', history: true, datesConfirmed: true, periodStart: '2026-09-01', periodEnd: '2026-09-15', dueDate: '2026-09-01' };
  assert.equal(validateRentPeriod(s, rec), null);
  assert.equal(validateRentPeriod(s, { ...rec, periodEnd: '2026-09-16' }), 'overlap');
  assert.equal(validateRentPeriod(s, { ...rec, periodStart: '2026-09-16', periodEnd: '2026-10-15' }), 'activePeriod');
  assert.equal(validateRentPeriod(s, { ...rec, history: false }), 'beforeLedger');
});

test('跟踪日不截短原租期；留空不回退到全屋开账月份，也不影响其他住户', () => {
  const s = fixture(), r = s.data.residents.b;
  r.rentTrackingStart = '2026-10-10';
  assert.equal(scheduledPeriods(s, r, '2026-10-18')[0].periodStart, '2026-10-16');
  r.rentTrackingStart = null;
  assert.equal(rentTrackingStart(s, r), null);
  assert.deepEqual(scheduledPeriods(s, r, '2026-10-18'), []);
  assert.equal(buildRentLedger(s, '2026-10-18').people.b.balance, 0);
  assert.equal(scheduledPeriods(s, s.data.residents.a, '2026-10-18')[0].periodStart, '2026-10-01');
  assert.equal(validateSchedules(s, { ...r, rentTrackingStart: '2026-02-30' }, r), 'trackingDate');
});

test('修改跟踪日保留已确认应收、收款和历史记录，不把历史补记再次算成欠款', () => {
  const s = fixture(), r = s.data.residents.b;
  const saved = { ...scheduledPeriods(s, r, '2026-10-18')[0], amount: 1000 };
  s.data.rents[saved.id] = saved;
  s.data.payments.p = { id: 'p', purpose: 'rent', residentId: 'b', rentId: saved.id, date: '2026-10-17', amount: 400 };
  const old = { id: 'old', residentId: 'b', history: true, datesConfirmed: true, periodStart: '2026-09-16', periodEnd: '2026-10-15', dueDate: '2026-09-10', paid: true, receivedAmount: 1000, paidDate: '2026-09-10' };
  s.data.rents.old = old;
  r.rentTrackingStart = '2026-09-16';
  assert.equal(scheduledPeriods(s, r, '2026-10-18').some(x => x.periodStart === old.periodStart), false);
  assert.equal(buildRentLedger(s, '2026-10-18').people.b.balance, 600);
  assert.equal(validateRentPeriod(s, old), null);
  r.rentTrackingStart = '2026-11-16';
  assert.equal(buildRentLedger(s, '2026-10-18').people.b.balance, 600);
  assert.equal(validateRentPeriod(s, { ...saved, amount: 900 }), null);
  r.rentTrackingStart = null;
  assert.equal(buildRentLedger(s, '2026-10-18').people.b.balance, 600);
  assert.equal(s.data.rents.old, old);
  assert.equal(s.data.payments.p.rentId, saved.id);
});
