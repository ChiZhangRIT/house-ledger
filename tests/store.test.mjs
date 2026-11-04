import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blankState, mergeStates, normalizeState, canon, stamp, live, newId, deletedRecord, restoredRecord } from '../src/core/store.js';

const withBill = (s, id, fields) => { s.data.bills[id] = { id, ...fields }; return s; };

test('merge keeps the newer copy of each record, from either side', () => {
  const a = withBill(blankState(), 'b1', { total: 10, updatedAt: 100 });
  const b = withBill(blankState(), 'b1', { total: 12, updatedAt: 200 });
  withBill(a, 'b2', { total: 5, updatedAt: 50 });
  for (const m of [mergeStates(a, b), mergeStates(b, a)]) {
    assert.equal(m.data.bills.b1.total, 12);
    assert.equal(m.data.bills.b2.total, 5);
  }
});

test('deletions win over older edits and are not resurrected', () => {
  const a = withBill(blankState(), 'b1', { total: 10, updatedAt: 100 });
  const b = withBill(blankState(), 'b1', { total: 10, deleted: true, updatedAt: 150 });
  assert.equal(mergeStates(a, b).data.bills.b1.deleted, true);
  assert.equal(live(mergeStates(a, b), 'bills').length, 0);
});

test('删除保留完整记录，重启及同步后可用相同 id 恢复，旧删除不会再次覆盖恢复', () => {
  const original = { id: 'b', providerId: 'p', statementDate: '2026-01-05', periodStart: '2025-12-01', periodEnd: '2026-01-01', total: 100, updatedAt: 10, source: { file: 'bill.pdf' } };
  const removed = deletedRecord(original, 20);
  assert.equal(removed.total, 100); assert.deepEqual(removed.source, original.source);
  const state = blankState(); state.data.bills.b = removed;
  const reloaded = normalizeState(JSON.parse(JSON.stringify(state)));
  assert.equal(live(reloaded, 'bills').length, 0);
  const restored = restoredRecord('bills', reloaded.data.bills.b, null, 15);
  assert.equal(restored.id, original.id); assert.equal(restored.total, 100);
  assert.equal(restored.deleted, undefined); assert.equal(restored.deletedAt, undefined);
  assert.ok(restored.updatedAt > removed.updatedAt);
  const other = blankState(); other.data.bills.b = restored;
  for (const merged of [mergeStates(reloaded, other), mergeStates(other, reloaded)]) assert.equal(live(merged, 'bills').length, 1);
});

test('旧删除标记不伪造内容；只能从同 id 的有效备份恢复，且不覆盖现有记录', () => {
  const removed = { id: 'r', deleted: true, updatedAt: 20 };
  assert.equal(restoredRecord('residents', removed), null);
  assert.equal(restoredRecord('residents', removed, { id: 'other', name: 'A', moveIn: '2025-01-01' }), null);
  assert.equal(restoredRecord('residents', removed, { id: 'r', name: 'A', moveIn: 'bad' }), null);
  const backup = { id: 'r', name: 'A', moveIn: '2025-01-01', rent: [{ from: '2025-01-01', amount: 1000 }] };
  assert.equal(restoredRecord('residents', removed, backup).name, 'A');
  assert.equal(restoredRecord('residents', removed, { ...backup, updatedAt: 1000 }, 10).updatedAt, 1001);
  assert.equal(restoredRecord('residents', backup, backup), null);
});

test('历史实收金额、备注及批注关联在备份和同步后保持，非法实收不成为收入', () => {
  const s = blankState();
  s.data.rents.r = { id: 'r', residentId: 'person', periodStart: '2026-09-16', history: true, paid: true, receivedAmount: 0, note: '备注', updatedAt: 2 };
  s.data.comments.c = { id: 'c', target: { collection: 'rents', id: 'r' }, comments: [{ text: '历史备注' }], updatedAt: 1 };
  const reloaded = normalizeState(JSON.parse(JSON.stringify(s)));
  assert.equal(reloaded.data.rents.r.receivedAmount, 0);
  assert.equal(reloaded.data.rents.r.note, '备注');
  assert.equal(mergeStates(blankState(), reloaded).data.comments.c.target.id, 'r');
  for (const bad of [-1, '100', Infinity]) {
    s.data.rents.r.receivedAmount = bad;
    assert.equal(normalizeState(s).data.rents.r.receivedAmount, null);
  }
});

test('same timestamp but different content resolves the same way on every device', () => {
  const a = withBill(blankState(), 'b1', { total: 10, updatedAt: 100 });
  const b = withBill(blankState(), 'b1', { total: 11, updatedAt: 100 });
  assert.equal(canon(mergeStates(a, b)), canon(mergeStates(b, a)));
});

test('settings merge per key by their own timestamps', () => {
  const a = blankState(), b = blankState();
  a.settings.lang = 'en'; a.settingsAt.lang = 300;
  b.settings.lang = 'zh-Hans'; b.settingsAt.lang = 200;
  b.settings.rentDay = 16; b.settingsAt.rentDay = 250;
  const m = mergeStates(a, b);
  assert.equal(m.settings.lang, 'en');
  assert.equal(m.settings.rentDay, 16);
});

test('normalize drops broken records and is stable', () => {
  const s = normalizeState({ data: { bills: { ok: { providerId: 'p', statementDate: '2025-01-05', periodStart: '2025-01-01', periodEnd: '2025-02-01', total: 1, updatedAt: '5' }, bad: 'x' }, residents: [] }, settings: { a: 1 } });
  assert.deepEqual(Object.keys(s.data.bills), ['ok']);
  assert.equal(s.data.bills.ok.updatedAt, 5);
  assert.equal(canon(normalizeState(s)), canon(s));
});

test('stamp is always newer than the previous version', () => {
  const prev = { id: 'x', updatedAt: 5000 };
  assert.equal(stamp({ id: 'x' }, prev, 1000).updatedAt, 5001);
  assert.ok(newId('p_').startsWith('p_') && newId() !== newId());
});

test('不认识的集合也保留并合并', async () => {
  const { normalizeState, mergeStates } = await import('../src/core/store.js');
  const a = normalizeState({ data: { future: { x: { id: 'x', v: 1, updatedAt: 5 } } } });
  const b = normalizeState({ data: { future: { x: { id: 'x', v: 2, updatedAt: 9 } }, bills: {} } });
  assert.equal(a.data.future.x.v, 1);
  assert.equal(mergeStates(a, b).data.future.x.v, 2);
  assert.deepEqual(normalizeState({ data: { junk: 3 } }).data.junk, undefined);
});

test('导入或同步来的坏数据：__proto__ 不污染原型，格式不对的记录丢掉，修得好的修好', async () => {
  const { normalizeState, mergeStates, blankState } = await import('../src/core/store.js');
  const evil = JSON.parse('{"data":{"__proto__":{"k":{"id":"k"}},"bills":{"__proto__":{"x":1},"constructor":{"id":"constructor","updatedAt":0},"ok":{"providerId":"p","statementDate":"2025-01-05","periodStart":"2025-01-01","periodEnd":"2025-02-01","total":10,"items":"nope","allocation":{"mode":"locked","shares":{"a":5,"__proto__":{"b":1}}}},"bad":{"providerId":"p","statementDate":null,"periodStart":"2025-01-01","periodEnd":"2025-02-01","total":10},"huge":{"providerId":"p","statementDate":"2025-01-05","periodStart":"2025-01-01","periodEnd":"2025-02-01","total":9.5e24}},"residents":{"r":{"name":"X","moveIn":"2025-01-01","rent":5,"weights":[{"from":"2025-01-01","weight":null}]}}},"settings":{"__proto__":{"polluted":1}}}');
  const s = normalizeState(evil);
  assert.equal(({}).k, undefined);
  assert.equal(({}).polluted, undefined);
  assert.deepEqual(Object.keys(s.data.bills), ['ok']);
  assert.deepEqual(s.data.bills.ok.items, []);
  assert.deepEqual(s.data.bills.ok.allocation, { mode: 'locked', shares: { a: 5 } });
  assert.deepEqual(s.data.residents.r.rent, []);
  assert.deepEqual(s.data.residents.r.weights, []);
  const m = mergeStates(blankState(), s);
  assert.equal(typeof m.data.bills.constructor, 'function');   // 普通对象的原型方法，不是合并进来的记录
  assert.ok(!Object.prototype.hasOwnProperty.call(m.data.bills, 'constructor'));
});
