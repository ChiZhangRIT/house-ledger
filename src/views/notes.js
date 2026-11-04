import { h } from '../ui/dom.js';
import { t } from '../i18n.js';
import { notesFor } from '../core/sourceNotes.js';

export function sourceNotes(state, collection, id, showSource = true) {
  const notes = collection ? notesFor(state, collection, id) : Object.values(state.data.comments || {}).filter(n => !n.deleted);
  if (!notes.length) return null;
  const thread = c => h('div.note-thread', null, h('p.comment-text', null, c.text),
    h('div.small.muted', null, c.author, c.createdAt ? ' · ' + c.createdAt.slice(0, 10) : ''), (c.replies || []).map(thread));
  return h('details' + (showSource ? '.card' : '') + '.source-notes', null, h('summary', null, t(showSource ? 'notes.title' : 'notes.saved', { n: notes.length })),
    notes.map(n => h('article.source-note', null,
      showSource ? h('div.small.muted', null, `${n.source.sheet} / ${n.source.table} · ${n.source.cell}`,
        n.field ? ' · ' + (n.field.startsWith('items.') ? t('item.' + n.field.slice(6)) : t('noteField.' + n.field)) : '')
        : n.target?.periodStart ? h('div.small.muted', null, n.target.periodStart.slice(0, 7)) : null, n.comments.map(thread))));
}
export function fieldGuide(keys) {
  return h('details.field-guide', null, h('summary', null, t('guide.title')), h('p.small.muted', null, t('guide.amounts')),
    keys.map(k => h('div.guide-row', null, h('b', null, t('item.' + k) === 'item.' + k ? k : t('item.' + k)),
      h('p.small.muted', null, t('guide.' + k) === 'guide.' + k ? t('guide.other') : t('guide.' + k)))));
}
