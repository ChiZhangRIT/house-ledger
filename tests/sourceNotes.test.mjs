import test from 'node:test';
import assert from 'node:assert/strict';
import { blankState, mergeStates, normalizeState, canon, stamp, deletedRecord, restoredRecord } from '../src/core/store.js';
import { notesImport, notesFor, patchNoteThread, hasVisibleNote } from '../src/core/sourceNotes.js';

test('批注及回复保留原文、作者、时间、单元格；NA 不伪造付款', () => {
  const state = blankState();
  state.data.residents.r = { id: 'r', name: 'Example', moveIn: '2023-01-01', updatedAt: 1 };
  state.data.providers.p = { name: 'Internet', category: 'internet' };
  state.data.bills.b = { id: 'b', providerId: 'p', statementDate: '2026-08-20', periodStart: '2026-08-21', periodEnd: '2026-09-20', total: 65.34, updatedAt: 99 };
  const comment = { text: 'Adjusted by support\nKeep this amount', author: 'Owner', createdAt: '2026-11-01', replies: [{ text: 'Reply', author: 'Owner', replies: [] }] };
  const row = ['2026-08-20', '2026-08-21', '2026-09-20', 65.34]; row[16] = 'Network Service';
  const patch = notesImport([{ sheet: 'Utilities', table: 'Bills', data: [[], [], [], [], [], row], comments: [{ row: 5, column: 3, cell: 'D6', comments: [comment] }] },
    { sheet: 'Monthly Rent', table: 'Rent', data: [['Month', null, 'Example'], [1, '1/16/24 - 2/15/24', 'NA']], comments: [{ row: 1, column: 2, cell: 'C2', comments: [comment] }] }], state);
  const combined = mergeStates(state, patch);
  assert.equal(Object.keys(combined.data.comments).length, 2);
  assert.deepEqual(notesFor(combined, 'bills', 'b')[0].comments, [comment]);
  assert.equal(notesFor(combined, 'bills', 'b')[0].field, 'total');
  assert.equal(notesFor(combined, 'residents', 'r')[0].target.periodStart, '2024-01-16');
  assert.deepEqual(combined.data.bills.b, state.data.bills.b);
  assert.equal(Object.keys(combined.data.payments).length, 0);
  assert.equal(canon(mergeStates(combined, patch)), canon(combined));
  assert.deepEqual(normalizeState(combined).data.comments, combined.data.comments);
});

test('补齐历史覆盖日期后，补导批注仍通过保留的旧日期找到同一记录', () => {
  const state = blankState();
  state.data.residents.r = { id:'r', name:'Example', moveIn:'2023-01-01' };
  state.data.rents.history = { id:'history',residentId:'r',history:true,datesConfirmed:true,periodStart:'2024-01-01',periodEnd:'2024-01-31',dueDate:'2024-01-01',legacyDate:'2024-01-16' };
  const patch = notesImport([{ sheet:'Monthly Rent',table:'Rent',data:[['Month',null,'Example'],[1,'1/16/24 - 2/15/24',true]],comments:[{row:1,column:2,cell:'C2',comments:[{text:'仍对应这一条记录'}]}] }],state);
  assert.equal(notesFor(patch,'rents','history').length,1);
  assert.equal(notesFor(patch,'residents','r').length,0);
});

test('导入批注及回复可单独编辑删除，路径、作者、时间和关联保持', () => {
  const note = { id:'note', target:{collection:'rents',id:'r'}, source:{file:'example.numbers',cell:'C3'},
    comments:[{text:'原备注',author:'A',createdAt:'2022-01-01',replies:[{text:'回复',author:'B'}]},{text:'第二条'}] };
  const updated = patchNoteThread(note, [0,0], {text:'改后的回复'});
  assert.equal(updated.comments[0].replies[0].text, '改后的回复');
  assert.equal(updated.comments[0].replies[0].author, 'B');
  assert.deepEqual(updated.source, note.source); assert.deepEqual(updated.target, note.target);
  assert.equal(note.comments[0].replies[0].text, '回复');
  const removed = patchNoteThread(updated,[0],{deleted:true});
  assert.equal(removed.comments[0].replies[0].text,'改后的回复');
  assert.equal(hasVisibleNote(removed),true);
  assert.equal(hasVisibleNote(patchNoteThread(removed,[1],{deleted:true})),false);
  assert.equal(patchNoteThread(removed,[0],{deleted:false}).comments[0].deleted,undefined);
});

test('编辑和删除批注经备份、同步、再次导入后不被旧文字覆盖，删除后能恢复', () => {
  const s=blankState(), original={id:'note',updatedAt:1,target:{collection:'bills',id:'bill'},comments:[{text:'旧文字',replies:[]}]};
  s.data.comments.note=stamp(patchNoteThread(original,[0],{text:'新文字'}),original,100);
  const old=blankState();old.data.comments.note=original;
  const reloaded=normalizeState(JSON.parse(JSON.stringify(mergeStates(s,old))));
  assert.equal(reloaded.data.comments.note.comments[0].text,'新文字');
  reloaded.data.comments.note=deletedRecord(reloaded.data.comments.note,200);
  const synced=mergeStates(old,reloaded);
  assert.equal(notesFor(synced,'bills','bill').length,0);
  const restored=restoredRecord('comments',synced.data.comments.note,null,300);
  assert.equal(restored.comments[0].text,'新文字');
  assert.deepEqual(restored.target,original.target);
});
