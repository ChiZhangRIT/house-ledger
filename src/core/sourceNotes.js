// 原始单元格批注独立保存：补导不会覆盖在 app 里改过的账单、住户或房租记录。
import { live, blankState } from './store.js';

const value = x => x && typeof x === 'object' && 'v' in x ? x.v : x;
const iso = x => typeof value(x) === 'string' ? value(x).slice(0, 10) : null;
const rentDate = x => {
  const m = String(value(x) || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})/);
  return m ? `20${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : null;
};
const BILL_FIELDS = ['statementDate', 'periodStart', 'periodEnd', 'total'];
const PARTS = { 'PG&E': ['electric_delivery', 'electric_generation', 'gas'], 'Sunnyvale Utility': ['water', 'sewer', 'garbage'] };

export function notesImport(dump, state, file = 'Shared Utilities.numbers') {
  const patch = blankState();
  const residents = live(state, 'residents'), bills = live(state, 'bills');
  for (const table of dump) for (const entry of table.comments || []) {
    const { row, column, cell } = entry, cells = table.data[row] || [];
    let target = null, field = null;
    if (table.sheet === 'Utilities' && row >= 5) {
      const date = iso(cells[0]), start = iso(cells[1]), cat = value(cells[16]);
      const category = { 'PG&E': 'energy', 'Sunnyvale Utility': 'water', 'Network Service': 'internet' }[cat];
      const candidates = bills.filter(b => (state.data.providers[b.providerId] || {}).category === category &&
        (b.statementDate === date || b.periodStart === start));
      const bill = candidates.length === 1 ? candidates[0] : candidates.find(b => b.statementDate === date && b.periodStart === start);
      if (bill) target = { collection: 'bills', id: bill.id };
      field = BILL_FIELDS[column] || (column >= 4 && column <= 6 ? 'items.' + (PARTS[cat]?.[column - 4] || 'internet') : column >= 7 && column <= 15 ? 'allocation' : 'note');
    } else if (table.sheet === 'Monthly Rent') {
      const name = value(table.data[0]?.[column]), person = residents.find(r => r.name === name);
      const date = rentDate(cells[1]);
      if (person) {
        // NA/空白格也可能有重要批注；关联到住户和期次，不伪造付款记录。
        const rent = live(state, 'rents').find(r => r.residentId === person.id && r.periodStart === date);
        target = { collection: rent ? 'rents' : 'residents', id: rent ? rent.id : person.id, residentId: person.id, periodStart: date };
        field = 'rent';
      }
    } else if (table.sheet === 'Utilities' && column >= 7 && column <= 15) {
      const person = residents.find(r => r.name === value(table.data[0]?.[column]));
      if (person) target = { collection: 'residents', id: person.id };
      field = ['name', 'moveIn', 'moveOut', 'personDays'][row] || null;
    }
    const id = 'note_' + [table.sheet, table.table, cell].map(s => encodeURIComponent(s).replace(/%/g, '_')).join('.');
    patch.data.comments[id] = { id, updatedAt: 1, source: { file, sheet: table.sheet, table: table.table, cell, row, column },
      target, field, value: value(cells[column]) ?? null, comments: entry.comments };
  }
  return patch;
}

export function notesFor(state, collection, id) {
  return live(state, 'comments').filter(n => n.target && n.target.collection === collection && n.target.id === id);
}
