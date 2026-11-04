// 单条恢复，不用整份旧备份覆盖当前账本。
import { h, openSheet } from '../ui/dom.js';
import { t, money, date } from '../i18n.js';
import { rentOverlap } from '../core/rentPeriods.js';
import { rentRange } from './rentHistory.js';
import { normalizeState, restoredRecord } from '../core/store.js';

const COLLECTIONS = ['bills', 'residents', 'rents', 'payments', 'adjustments'];
const deletedRows = ctx => COLLECTIONS.flatMap(collection => Object.values(ctx.S.data[collection]).filter(r => r.deleted).map(record => ({ collection, record })))
  .sort((a, b) => (b.record.deletedAt || b.record.updatedAt) - (a.record.deletedAt || a.record.updatedAt));
const label = (ctx, c, r) => {
  if (c === 'bills') return r.statementDate ? `${ctx.S.data.providers[r.providerId]?.name || ''} · ${date(r.statementDate, 'iso')} · ${money(r.total)}` : r.id;
  if (c === 'residents') return r.name || r.id;
  const name = ctx.S.data.residents[r.residentId]?.name || r.residentId || r.id;
  return name + (c === 'rents' ? ' · ' + rentRange(r) : r.date ? ' · ' + date(r.date, 'iso') : '');
};

export function openDeleted(ctx) {
  const body = h('div');
  const recover = (collection, record, backup) => {
    const current = ctx.S.data[collection][record.id];
    const restored = restoredRecord(collection, current, backup);
    if (!restored) { ctx.toast(t('deleted.needsBackup')); return; }
    if (collection === 'residents' && restored.isOwner && ctx.D.residents.some(r => r.isOwner && r.id !== restored.id)) {
      ctx.toast(t('deleted.ownerConflict')); return;
    }
    if (collection === 'rents' && Object.values(ctx.S.data.rents).some(r => !r.deleted && r.id !== restored.id && r.residentId === restored.residentId && rentOverlap(r, restored))) {
      ctx.toast(t('rent.historyError.overlap')); return;
    }
    ctx.put(collection, restored); draw(); ctx.toast(t('deleted.restored'));
  };
  const table = (rows, backup, refresh) => h('div.table-scroll', null, h('table.data-table', null,
    h('thead', null, h('tr', null, [t('deleted.type'), t('deleted.record'), t('deleted.date'), ''].map(x => h('th', null, x)))),
    h('tbody', null, rows.map(({ collection, record }) => {
      const source = backup?.data[collection]?.[record.id];
      const canRestore = restoredRecord(collection, record, source);
      return h('tr', null, h('td', null, t('deleted.' + collection)), h('th', { scope: 'row' }, label(ctx, collection, source || record)),
        h('td.date-cell', null, date(record.deletedAt || record.updatedAt ? new Date(record.deletedAt || record.updatedAt).toISOString().slice(0, 10) : null, 'iso')),
        h('td', null, canRestore ? h('button.btn', { type: 'button', onclick: () => { recover(collection, record, source); refresh?.(); } }, t('deleted.restore')) : h('span.small.muted', null, t('deleted.needsBackup'))));
    }))));
  const readBackup = async file => {
    if (file.size > 20 * 1024 * 1024) { ctx.toast(t('imp.tooBig')); return; }
    let data;
    try { data = JSON.parse(await file.text()); } catch (e) { ctx.toast(t('imp.bad')); return; }
    if (data?.app !== 'house-ledger' || !data.state) { ctx.toast(t('imp.bad')); return; }
    const backup = normalizeState(data.state), preview = h('div');
    const update = () => {
      const rows = deletedRows(ctx).filter(({ collection, record }) => {
        const source = backup.data[collection]?.[record.id];
        return source && restoredRecord(collection, record, source);
      });
      preview.replaceChildren(h('p.note', null, t('deleted.backupHint')), rows.length ? table(rows, backup, update) : h('p.muted', null, t('deleted.noMatch')));
    };
    update();
    openSheet({ title: t('deleted.fromBackup'), wide: true, body: preview });
  };
  const fileInput = h('input', { type: 'file', accept: '.json,application/json', hidden: true, onchange: e => {
    const file = e.target.files[0]; e.target.value = ''; if (file) readBackup(file);
  } });
  const draw = () => {
    const rows = deletedRows(ctx);
    body.replaceChildren(h('p.note', null, t('deleted.hint')), rows.length ? table(rows) : h('p.muted', null, t('deleted.empty')),
      h('button.btn', { type: 'button', onclick: () => fileInput.click() }, t('deleted.fromBackup')), fileInput);
  };
  draw(); openSheet({ title: t('deleted.title'), wide: true, body });
}
