import test from 'node:test';
import assert from 'node:assert/strict';
import { blankState, normalizeState, mergeStates, deletedRecord, restoredRecord, canon } from '../src/core/store.js';
import { buildRentLedger, rentPeriodSummary, rentReceipts, rentPayments, rentRecordEntries } from '../src/core/rent.js';

function fixture() {
  const s = blankState();
  s.data.residents.r = { id:'r', name:'Example', moveIn:'2024-11-01', rentTrackingStart:null, rent:[], rentSchedules:[] };
  for (const [id, start, end] of [['nov','2024-11-01','2024-11-30'],['dec','2024-12-01','2024-12-31'],['jan','2025-01-01','2025-01-31'],['mar','2025-03-01','2025-03-31'],['aug','2025-08-01','2025-08-31']]) {
    s.data.rents[id] = { id, residentId:'r', history:false, datesConfirmed:true, periodStart:start, periodEnd:end, dueDate:start, amount:1700 };
  }
  return s;
}
const transfer = (id, amount, allocations) => ({id, residentId:'r', purpose:'housing', amount, allocations, date:'2025-03-01', method:'alipay', note:'原始转账备注', updatedAt:100});
const rent = (rentId, amount) => ({purpose:'rent', rentId, amount});
const deposit = amount => ({purpose:'deposit', amount});

test('同笔转账分给多期房租与押金，退押金不冲减房租，截图中的 5100 不再错挂', () => {
  const s=fixture();
  s.data.payments.three=transfer('three',5100,[rent('nov',1700),rent('dec',1700),rent('jan',1700)]);
  s.data.payments.mixed=transfer('mixed',3400,[rent('mar',1700),deposit(1700)]);
  s.data.payments.last=transfer('last',1700,[rent('aug',1700)]);
  s.data.payments.return=transfer('return',-1700,[deposit(-1700)]);
  const p=buildRentLedger(s,'2026-11-09').people.r;
  assert.deepEqual([p.balance,p.overdue,p.outstanding,p.credit],[0,0,0,0]);
  assert.equal(rentPayments(s).reduce((n,p)=>n+p.amount,0),8500);
  assert.deepEqual(rentReceipts(s).values,[8500]);
  for(const period of Object.values(s.data.rents))assert.equal(rentPeriodSummary(s,period).remaining,0);
  assert.equal(s.data.payments.mixed.amount,3400);
  assert.equal(s.data.payments.mixed.note,'原始转账备注');
});

test('租期删除不得删除同时覆盖其他租期或押金的整笔转账', () => {
  const s=fixture();
  s.data.payments.shared=transfer('shared',3400,[rent('nov',1700),deposit(1700)]);
  s.data.payments.single=transfer('single',1700,[rent('nov',1700)]);
  const entries=rentRecordEntries(s,s.data.rents.nov);
  assert.deepEqual(entries.map(([c,r])=>[c,r.id]),[['rents','nov'],['payments','single']]);
  for(const [c,r]of entries)s.data[c][r.id]=deletedRecord(r,200);
  assert.equal(s.data.payments.shared.deleted,undefined);
  assert.equal(buildRentLedger(s,'2026-11-09').people.r.unassignedPayments[0].transferId,'shared');
});

test('押金余额独立；修改同一转账的分配不重复金额，备份同步与删除恢复保留完整分配', async () => {
  const {depositSummary,housingPayments}=await import('../src/core/rent.js');
  const {paymentTransfer}=await import('../src/core/payments.js');
  const s=fixture();
  s.data.payments.mixed=transfer('mixed',3400,[rent('mar',1700),deposit(1700)]);
  const original=canon(s);
  assert.equal(depositSummary(s,'r').balance,1700);
  assert.equal(housingPayments(s).length,1);
  const portion=rentPayments(s)[0];
  assert.equal(paymentTransfer(s,portion),s.data.payments.mixed);
  assert.equal(portion.amount,1700);
  assert.deepEqual(rentReceipts(s).values,[1700]);
  assert.equal(canon(s),original);
  const old=structuredClone(s);
  s.data.payments.mixed={...s.data.payments.mixed,allocations:[rent('mar',2000),deposit(1400)],updatedAt:200,date:'',dateUnavailable:true};
  let restored=normalizeState(JSON.parse(JSON.stringify(mergeStates(old,s))));
  assert.equal(depositSummary(restored,'r').balance,1400);
  assert.equal(rentPayments(restored)[0].amount,2000);
  assert.deepEqual(rentReceipts(restored).values,[]);
  assert.equal(restored.data.payments.mixed.note,'原始转账备注');
  restored.data.payments.mixed=deletedRecord(restored.data.payments.mixed,300);
  assert.equal(depositSummary(restored,'r').balance,0);
  assert.equal(rentPayments(restored).length,0);
  restored.data.payments.mixed=restoredRecord('payments',restored.data.payments.mixed,null,400);
  assert.equal(depositSummary(restored,'r').balance,1400);
  assert.equal(rentPayments(restored)[0].dateUnavailable,true);
});

test('分配金额必须合计为总额，同一目标不能重复，收款与退款的方向一致', async () => {
  const {allocationError}=await import('../src/core/payments.js');
  assert.equal(allocationError(transfer('a',.3,[rent('mar',.1),deposit(.2)])),null);
  assert.equal(allocationError(transfer('a',3400,[rent('mar',1700),deposit(1600)])),'total');
  assert.equal(allocationError(transfer('a',3400,[rent('mar',1700),rent('mar',1700)])),'duplicate');
  assert.equal(allocationError(transfer('a',100,[rent('mar',200),deposit(-100)])),'amount');
  assert.equal(allocationError(transfer('a',-3400,[rent('mar',-1700),deposit(-1700)])),null);
  const s=fixture();
  s.data.payments.bad=transfer('bad',3400,[rent('mar',1700)]);
  assert.equal(normalizeState(s).data.payments.bad,undefined);
});

test('旧收款可改分为房租与押金，同 id 去重；未知金额不允许拆分', async () => {
  const {rentReceiptChanges,depositSummary}=await import('../src/core/rent.js');
  const s=fixture();
  s.data.rents.mar={...s.data.rents.mar,paid:true,receivedAmount:3400,paidDate:'2025-03-01',note:'保留原备注'};
  const before=rentPayments(s)[0],changes=rentReceiptChanges(s,before);
  s.data.rents.mar=changes.rent;
  s.data.payments[before.id]={...changes.receipt,purpose:'housing',rentId:null,allocations:[rent('mar',1700),deposit(1700)]};
  assert.equal(rentPayments(s).length,1);
  assert.equal(depositSummary(s,'r').balance,1700);
  assert.equal(rentPeriodSummary(s,s.data.rents.mar).remaining,0);
  s.data.rents.mar.paid=true;s.data.rents.mar.receivedAmount=3400;
  assert.equal(rentPayments(s).length,1);
  assert.equal(s.data.rents.mar.note,'保留原备注');
  const invalid=fixture();invalid.data.payments.x={...transfer('x',null,[deposit(null)]),confirmationOnly:true};
  assert.equal(normalizeState(invalid).data.payments.x,undefined);
});

test('各期同时待收与多收时标识款项分配问题；明确重新分配后同样租期全部结清', () => {
  const s=fixture();
  for(const [id,rentId,amount]of[['three','jan',5100],['mixed','mar',3400],['last','aug',1700],['return','aug',-1700]])s.data.payments[id]={id,residentId:'r',purpose:'rent',rentId,amount,date:'2025-03-01'};
  const before=buildRentLedger(s,'2026-11-09').people.r;
  assert.deepEqual([before.balance,before.overdue,before.credit,before.hasUnmatchedCredit],[0,5100,5100,true]);
  s.data.payments.three={...s.data.payments.three,purpose:'housing',rentId:null,allocations:[rent('nov',1700),rent('dec',1700),rent('jan',1700)]};
  s.data.payments.mixed={...s.data.payments.mixed,purpose:'housing',rentId:null,allocations:[rent('mar',1700),deposit(1700)]};
  s.data.payments.return={...s.data.payments.return,purpose:'housing',rentId:null,allocations:[deposit(-1700)]};
  const after=buildRentLedger(s,'2026-11-09').people.r;
  assert.deepEqual([after.balance,after.overdue,after.credit,after.hasUnmatchedCredit],[0,0,0,false]);
  assert.deepEqual(after.incompletePeriods,[]);
});
