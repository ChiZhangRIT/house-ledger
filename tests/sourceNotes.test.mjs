import test from 'node:test';
import assert from 'node:assert/strict';
import { blankState, mergeStates, normalizeState, canon } from '../src/core/store.js';
import { notesImport, notesFor } from '../src/core/sourceNotes.js';

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
