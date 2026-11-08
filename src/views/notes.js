import { h, openSheet } from '../ui/dom.js';
import { t } from '../i18n.js';
import { notesFor, patchNoteThread, hasVisibleNote } from '../core/sourceNotes.js';

export function openRecordNote(ctx, collection, id, onChange) {
  const record = ctx.S.data[collection][id];
  let value = record.note || '';
  const save = () => {
    const current = ctx.S.data[collection][id];
    if (!current || current.deleted) return;
    ctx.put(collection, { ...current, note: value.trim() }); sheet.close(); onChange?.();
    ctx.toast(t('notes.updated'));
  };
  const sheet = openSheet({ title: t('notes.edit'), closeLabel: t('rent.close'), body: h('label.field', null, h('span.field-label', null, t('form.note')),
    h('textarea', { rows: 6, value, oninput: e => { value = e.target.value; } })),
    foot: [h('span.sp'), h('button.btn', { type: 'button', onclick: () => sheet.close() }, t('cancel')), h('button.btn.primary', { type: 'button', onclick: save }, t('save'))] });
}

function deleteConfirmation(action) {
  const sheet = openSheet({ title: t('notes.delete'), closeLabel: t('rent.close'), body: h('p', null, t('notes.deleteConfirm')),
    foot: [h('span.sp'), h('button.btn', { type: 'button', onclick: () => sheet.close() }, t('cancel')),
      h('button.btn.danger', { type: 'button', onclick: () => { action(); sheet.close(); } }, t('bill.delete'))] });
}

function editThread(ctx, note, path, comment, onChange) {
  let value = comment.text || '';
  const err = h('p.err', { hidden: true });
  const save = () => {
    if (!value.trim()) { err.textContent = t('notes.needText'); err.hidden = false; return; }
    const current = ctx.S.data.comments[note.id];
    if (!current || current.deleted) return;
    if (current.updatedAt !== note.updatedAt && !confirm(t('form.changedElsewhere'))) return;
    const updated = patchNoteThread(current, path, { text: value.trim() });
    if (!updated) return;
    ctx.put('comments', updated); sheet.close(); onChange?.(); ctx.toast(t('notes.updated'));
  };
  const sheet = openSheet({ title: t('notes.edit'), closeLabel: t('rent.close'), body: h('div.form', null,
    h('label.field', null, h('span.field-label', null, t('form.note')), h('textarea', { rows: 6, value, oninput: e => { value = e.target.value; } })), err),
    foot: [h('span.sp'), h('button.btn', { type: 'button', onclick: () => sheet.close() }, t('cancel')), h('button.btn.primary', { type: 'button', onclick: save }, t('save'))] });
}

function thread(ctx, note, comment, path, onChange) {
  const change = changes => {
    const previous = ctx.S.data.comments[note.id], updated = patchNoteThread(previous, path, changes);
    if (!updated) return;
    if (hasVisibleNote(updated)) ctx.put('comments', updated); else ctx.remove('comments', note.id);
    onChange?.();
    ctx.toast(t(changes.deleted ? 'notes.deleted' : 'notes.restored'), { action: t('undo'), onAction: () => { ctx.put('comments', previous); onChange?.(); }, ms: 10000 });
  };
  if (comment.deleted) return h('details.note-thread', null, h('summary', null, t('notes.deletedPart')),
    h('p.comment-text', null, comment.text), h('button.link-btn', { type: 'button', onclick: () => change({ deleted: false }) }, t('deleted.restore')));
  return h('div.note-thread', null, h('p.comment-text', null, comment.text),
    h('div.row.small.muted', null, h('span', null, comment.author || '', comment.createdAt ? ' · ' + comment.createdAt.slice(0, 10) : ''), h('span.sp'),
      h('button.link-btn', { type: 'button', onclick: () => editThread(ctx, note, path, comment, onChange) }, t('notes.edit')),
      h('button.link-btn.danger', { type: 'button', onclick: () => deleteConfirmation(() => change({ deleted: true })) }, t('notes.delete'))),
    (comment.replies || []).map((c, i) => thread(ctx, note, c, [...path, i], onChange)));
}

function importedNotes(ctx, notes, onChange) {
  return notes.map(n => h('article.source-note', null,
    n.field && n.target?.collection === 'bills' ? h('div.small.muted', null, n.field.startsWith('items.') ? t('item.' + n.field.slice(6)) : t('noteField.' + n.field)) : null,
    (n.comments || []).map((c, i) => thread(ctx, n, c, [i], onChange))));
}

export function recordNotes(ctx, collection, record, onChange) {
  const notes = notesFor(ctx.S, collection, record.id);
  if (!record.note && !notes.length) return null;
  const remove = () => deleteConfirmation(() => {
    const current = ctx.S.data[collection][record.id], previous = current.note;
    ctx.put(collection, { ...current, note: '' }); onChange?.();
    ctx.toast(t('notes.deleted'), { action: t('undo'), onAction: () => { ctx.put(collection, { ...ctx.S.data[collection][record.id], note: previous }); onChange?.(); }, ms: 10000 });
  });
  return h('div.record-notes', null,
    record.note ? h('div.note-thread', null, h('p.comment-text', null, record.note), h('div.row', null,
      h('button.link-btn', { type: 'button', onclick: () => openRecordNote(ctx, collection, record.id, onChange) }, t('notes.edit')),
      h('button.link-btn.danger', { type: 'button', onclick: remove }, t('notes.delete')))) : null,
    importedNotes(ctx, notes, onChange));
}

export function billNotes(ctx, bill) {
  const notes = recordNotes(ctx, 'bills', bill);
  return notes ? h('section.card.bill-notes', null, h('h2.section-h', null, t('bill.notes')), notes) : null;
}

export function fieldGuide(keys) {
  return h('details.field-guide', null, h('summary', null, t('guide.title')), h('p.small.muted', null, t('guide.amounts')),
    keys.map(k => h('div.guide-row', null, h('b', null, t('item.' + k) === 'item.' + k ? k : t('item.' + k)),
      h('p.small.muted', null, t('guide.' + k) === 'guide.' + k ? t('guide.other') : t('guide.' + k)))));
}
