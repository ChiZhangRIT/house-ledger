// 数据层：所有数据都是「集合 → 记录」，每条记录有 id、updatedAt（毫秒时间戳），删除时留一个 deleted 标记。
// 多台设备合并时逐条比较 updatedAt，取较新的一份；时间相同但内容不同时按内容排序取一份，保证每台设备结果一样。

export const COLLECTIONS = ['providers', 'residents', 'bills', 'payments', 'rents', 'adjustments', 'exports', 'dismissals', 'comments', 'servicePeriods'];
// 不认识的集合（以后的版本新加的）也原样保留、照样合并，旧版 app 同步时不会把它们弄丢
const collectionsOf = (...states) => [...new Set([...COLLECTIONS, ...states.flatMap(s => Object.keys((s && s.data) || {}))])].filter(c => safeKey(c));
const own = (o, k) => (o && Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined);

export function blankState() {
  return { app: 'house-ledger', v: 1, data: Object.fromEntries(COLLECTIONS.map(c => [c, {}])), settings: {}, settingsAt: {} };
}

/** 和键的顺序无关的序列化：用来判断两份数据是否一样，以及打平时决定取哪一份 */
export function canon(v) {
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
  }
  return JSON.stringify(v === undefined ? null : v);
}

const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
// 集合名、记录 id、设置的键：不许用 __proto__ 之类（导入的文件或云端文件可能是别人做的）
const SAFE_KEY = /^[A-Za-z0-9_.:@-]{1,200}$/;
const safeKey = k => typeof k === 'string' && SAFE_KEY.test(k) && k !== '__proto__' && k !== 'constructor' && k !== 'prototype';

// 每类记录的字段检查：修得好的就修（比如 items 不是数组就当空），修不好的（日期、金额不对）整条丢掉，
// 免得一条坏记录让所有页面都打不开。删除标记（deleted）原样保留。
const ISO = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const MONTH = s => typeof s === 'string' && /^\d{4}-\d{2}$/.test(s);
const amount = v => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1e7;
const str = v => (typeof v === 'string' ? v : v == null ? '' : String(v));
const VALIDATE = {
  providers: r => (typeof r.name === 'string' ? { ...r, category: ['energy', 'water', 'internet'].includes(r.category) ? r.category : 'internet' } : null),
  residents: r => (typeof r.name === 'string' && ISO(r.moveIn) ? {
    ...r, moveOut: ISO(r.moveOut) ? r.moveOut : null,
    weights: (Array.isArray(r.weights) ? r.weights : []).filter(w => isObj(w) && ISO(w.from) && typeof w.weight === 'number' && Number.isFinite(w.weight) && w.weight >= 0 && w.weight <= 100),
    rent: (Array.isArray(r.rent) ? r.rent : []).filter(x => isObj(x) && ISO(x.from) && amount(x.amount)),
    utilities: isObj(r.utilities) ? r.utilities : {},
  } : null),
  bills: r => (ISO(r.statementDate) && ISO(r.periodStart) && ISO(r.periodEnd) && amount(r.total) && typeof r.providerId === 'string' ? {
    ...r, dueDate: ISO(r.dueDate) ? r.dueDate : null, collectPeriod: MONTH(r.collectPeriod) ? r.collectPeriod : null,
    items: (Array.isArray(r.items) ? r.items : []).filter(i => isObj(i) && amount(i.amount)).map(i => ({ ...i, key: str(i.key) || 'other', label: str(i.label) })),
    usage: (Array.isArray(r.usage) ? r.usage : []).filter(u => isObj(u) && typeof u.amount === 'number' && Number.isFinite(u.amount) && u.amount >= 0 && u.amount < 1e9).map(u => ({ ...u, key: str(u.key), unit: str(u.unit) })),
    allocation: isObj(r.allocation) && ['auto', 'manual', 'locked'].includes(r.allocation.mode)
      ? (r.allocation.mode === 'auto' ? { mode: 'auto' } : { mode: r.allocation.mode, shares: Object.fromEntries(Object.entries(isObj(r.allocation.shares) ? r.allocation.shares : {}).filter(([k, v]) => safeKey(k) && amount(v))) })
      : { mode: 'auto' },
    source: isObj(r.source) ? r.source : {},
  } : null),
  payments: r => (typeof r.residentId === 'string' && ISO(r.date) && amount(r.amount) ? r : null),
  rents: r => (typeof r.residentId === 'string' && typeof r.periodStart === 'string' && /^\d{4}-\d{2}/.test(r.periodStart) ? { ...r, amount: amount(r.amount) ? r.amount : null, receivedAmount: amount(r.receivedAmount) && r.receivedAmount >= 0 ? r.receivedAmount : null } : null),
  adjustments: r => (typeof r.residentId === 'string' && MONTH(r.collectPeriod) && amount(r.amount) ? r : null),
};

/** 读入本地、云端或导入的数据时的整理：丢掉格式不对的记录，补齐缺的集合 */
export function normalizeState(s) {
  const out = blankState();
  if (!isObj(s) || !isObj(s.data)) return out;
  for (const c of collectionsOf(s)) {
    if (!safeKey(c) || (s.data[c] !== undefined && !isObj(s.data[c]))) continue;
    const src = Object.prototype.hasOwnProperty.call(s.data, c) && isObj(s.data[c]) ? s.data[c] : {};
    out.data[c] = out.data[c] || {};
    for (const [id, rec] of Object.entries(src)) {
      if (!isObj(rec) || !safeKey(id)) continue;
      let r = { ...rec, id, updatedAt: Number(rec.updatedAt) || 0 };
      if (!r.deleted && VALIDATE[c]) { r = VALIDATE[c](r); if (!r) continue; }
      out.data[c][id] = r;
    }
  }
  if (isObj(s.settings)) for (const [k, v] of Object.entries(s.settings)) if (safeKey(k)) out.settings[k] = v;
  if (isObj(s.settingsAt)) for (const [k, t] of Object.entries(s.settingsAt)) if (safeKey(k) && Number(t) > 0) out.settingsAt[k] = Number(t);
  return out;
}

function pick(a, b) {
  if (!a) return b;
  if (!b) return a;
  if ((b.updatedAt || 0) !== (a.updatedAt || 0)) return (b.updatedAt || 0) > (a.updatedAt || 0) ? b : a;
  return canon(b) > canon(a) ? b : a;
}

/** 两份数据逐条合并 */
export function mergeStates(a, b) {
  const out = blankState();
  for (const c of collectionsOf(a, b)) {
    out.data[c] = out.data[c] || {};
    const ids = new Set([...Object.keys(own(a.data, c) || {}), ...Object.keys(own(b.data, c) || {})]);
    for (const id of ids) if (safeKey(id)) out.data[c][id] = pick(own(own(a.data, c), id), own(own(b.data, c), id));
  }
  const keys = new Set([...Object.keys(a.settings), ...Object.keys(b.settings), ...Object.keys(a.settingsAt), ...Object.keys(b.settingsAt)]);
  for (const k of keys) {
    if (!safeKey(k)) continue;
    const ta = own(a.settingsAt, k) || 0, tb = own(b.settingsAt, k) || 0;
    const from = tb > ta ? b : ta > tb ? a : (canon(own(b.settings, k)) > canon(own(a.settings, k)) ? b : a);
    if (own(from.settings, k) !== undefined) out.settings[k] = own(from.settings, k);
    if (ta || tb) out.settingsAt[k] = Math.max(ta, tb);
  }
  return out;
}

/** 新的或修改过的记录：盖上修改时间（比旧的至少新 1 毫秒，避免同一毫秒内改两次分不出先后） */
export function stamp(rec, prev, now = Date.now()) {
  return { ...rec, updatedAt: Math.max(now, ((prev && prev.updatedAt) || 0) + 1) };
}

/** 删除仍参与同步，但保留内容，方便在「最近删除」中恢复。 */
export function deletedRecord(rec, now = Date.now()) {
  return rec && !rec.deleted ? stamp({ ...rec, deleted: true, deletedAt: now }, rec, now) : null;
}

/** 旧版只有 id 的删除标记必须有同 id 的有效备份；恢复时间必须晚于删除。 */
export function restoredRecord(collection, removed, backup = null, now = Date.now()) {
  if (!removed?.deleted || !VALIDATE[collection]) return null;
  const source = backup || removed;
  if (source.id !== removed.id) return null;
  const { deleted, deletedAt, ...rec } = source;
  const valid = VALIDATE[collection](rec);
  return valid ? stamp(valid, { updatedAt: Math.max(removed.updatedAt || 0, source.updatedAt || 0) }, now) : null;
}

/** 没有删除的记录列表 */
export const live = (state, c) => Object.values(state.data[c]).filter(r => !r.deleted);

/** 生成记录 id：时间 + 随机，几台设备同时新建也不会撞 */
export function newId(prefix = '') {
  const rnd = (globalThis.crypto && crypto.getRandomValues) ? [...crypto.getRandomValues(new Uint8Array(6))].map(b => b.toString(36).padStart(2, '0')).join('') : Math.random().toString(36).slice(2, 12);
  return prefix + Date.now().toString(36) + rnd;
}
