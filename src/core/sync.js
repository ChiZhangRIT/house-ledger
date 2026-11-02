// 多设备同步：数据存在用户自己的 GitHub 私有仓库里（一个 JSON 文件），用 GitHub 的 contents API 读写。
// 每次同步：先拉云端 → 和本机逐条合并 → 本机有云端没有的改动才上传；上传时带上云端版本号（sha），
// 云端在这期间被别的设备改过就会返回 409，这时重新拉取合并再传。
import { normalizeState, mergeStates, canon } from './store.js';

export const GH_API = 'https://api.github.com';
export const SYNC_FILE = 'house-ledger.json';

export function toB64(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
export function fromB64(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/** 同步出错：带错误代码（显示时再翻译），网络问题单独标出来 */
export class SyncError extends Error {
  constructor(code, vars = {}) { super(code); this.code = code; this.vars = vars; }
}

/**
 * @param {object} o
 * @param {() => object} o.getState            当前本机数据
 * @param {(merged, info) => void} o.applyRemote  合并出新内容时调用（info.device = 上次写入云端的设备名）
 * @param {() => object|null} o.getConfig      { repo, token, sha, etag, dirty, ... }，没开同步时返回 null
 * @param {(cfg) => void} o.saveConfig         保存同步状态（只存本机，不进数据）
 * @param {() => number} o.editVersion         本机数据的修改计数：上传期间又改过的话，上传完仍然算「有改动」
 * @param {string} o.device                    这台设备的名字（写进云端，方便提示是谁改的）
 * @param {typeof fetch} [o.fetch]
 */
export function createSync(o) {
  const doFetch = o.fetch || ((...a) => fetch(...a));
  let chain = Promise.resolve();
  let verified = null;          // 这次打开 app 已经确认过是私有仓库的 repo 名

  /** 仓库必须是私有的（visibility 为 private；企业版的 internal 也不行） */
  async function ensurePrivate(cfg) {
    if (verified === cfg.repo) return;
    const r = await gh(cfg, 'GET', `/repos/${cfg.repo}`);
    if (!r.ok) throw httpError(r);
    const info = await r.json();
    if (!(info.visibility ? info.visibility === 'private' : info.private)) throw new SyncError('public');
    verified = cfg.repo;
  }

  async function gh(cfg, method, path, { body, etag, accept } = {}) {
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 20000);
    const headers = { Authorization: 'Bearer ' + cfg.token, Accept: accept || 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
    if (body) headers['Content-Type'] = 'application/json';
    if (etag) headers['If-None-Match'] = etag;
    try {
      return await doFetch(GH_API + path, { method, headers, body: body ? JSON.stringify(body) : undefined, cache: 'no-store', signal: ctl.signal });
    } catch (e) {
      throw new SyncError('net');
    } finally {
      clearTimeout(timer);
    }
  }
  const filePath = cfg => `/repos/${cfg.repo}/contents/${SYNC_FILE}`;
  function httpError(r) {
    if (r.status === 401) return new SyncError('auth');
    if (r.status === 403 || r.status === 404) return new SyncError('perm');
    return new SyncError('http', { status: r.status });
  }

  async function pull(cfg) {
    const r = await gh(cfg, 'GET', filePath(cfg), { etag: cfg.sha && cfg.etag });
    if (r.status === 304) return;
    if (r.status === 404) {                          // 云端还没有文件：第一次同步
      cfg.sha = cfg.etag = null;
      cfg.dirty = true;
      return;
    }
    if (!r.ok) throw httpError(r);
    const j = await r.json();
    cfg.etag = r.headers.get('ETag');
    if (j.sha === cfg.sha) return;
    let text = j.encoding === 'base64' && j.content ? fromB64(j.content) : null;
    if (text == null) {                              // 超过 1MB 的文件要单独取原文
      const raw = await gh(cfg, 'GET', filePath(cfg), { accept: 'application/vnd.github.raw+json' });
      if (!raw.ok) throw httpError(raw);
      text = await raw.text();
    }
    let d = null;
    try { d = JSON.parse(text); } catch (e) { d = null; }
    if (!d || d.app !== 'house-ledger' || !d.state) throw new SyncError('badFile', { file: SYNC_FILE });
    // 两边都先整理成同样的格式再比较：不然本机刚改的记录（还没补默认字段）和云端整理过的永远「不一样」，每次同步都会再传一遍
    const remote = normalizeState(d.state), local = normalizeState(o.getState()), merged = mergeStates(local, remote), cm = canon(merged);
    cfg.sha = j.sha;
    cfg.dirty = cm !== canon(remote);
    if (cm !== canon(local)) o.applyRemote(merged, { device: d.device || '' });
  }

  async function push(cfg) {
    if (!cfg.sha) { verified = null; await ensurePrivate(cfg); }   // 要新建文件（云端被删过或重建过）：再确认一次仓库没变成公开的
    for (let i = 0; i < 4; i++) {
      const version = o.editVersion();
      const body = {
        message: `更新账本（${o.device}）`,
        content: toB64(JSON.stringify({ app: 'house-ledger', v: 1, device: o.device, savedAt: new Date().toISOString(), state: o.getState() })),
      };
      if (cfg.sha) body.sha = cfg.sha;
      const r = await gh(cfg, 'PUT', filePath(cfg), { body });
      if (r.ok) {
        const j = await r.json();
        cfg.sha = j.content.sha;
        cfg.etag = null;
        cfg.dirty = o.editVersion() !== version;      // 上传期间又改过：留到下一次
        return;
      }
      if (r.status !== 409 && r.status !== 422) throw httpError(r);
      cfg.etag = null;
      await pull(cfg);                                // 云端被别的设备改过：合并后再传
      if (!cfg.dirty) return;
    }
    throw new SyncError('mergeFail');
  }

  async function run() {
    const cfg = o.getConfig();
    if (!cfg) return { ok: true, skipped: true };
    try {
      await ensurePrivate(cfg);
      await pull(cfg);
      if (cfg.dirty) await push(cfg);
      cfg.at = Date.now();
      cfg.offline = false;
      cfg.err = null;
      return { ok: true };
    } catch (e) {
      const code = e instanceof SyncError ? e.code : 'unknown';
      cfg.offline = code === 'net';
      cfg.err = code === 'net' ? null : { code, vars: e.vars || {}, message: e instanceof SyncError ? '' : String(e && e.message || e) };
      return { ok: false, error: cfg.err, offline: cfg.offline };
    } finally {
      o.saveConfig(cfg);
    }
  }

  /** 同一时间只跑一个同步 */
  function syncNow() {
    const p = chain.then(run);
    chain = p.catch(() => {});
    return p;
  }

  /** 连接一个仓库：先检查令牌和仓库（必须是私有的），再做第一次同步 */
  async function checkRepo(repo, token) {
    let r;
    try { r = await gh({ token }, 'GET', `/repos/${repo}`); } catch (e) { throw new SyncError('net'); }
    if (r.status === 401) throw new SyncError('auth');
    if (!r.ok) throw new SyncError('notFound');
    const info = await r.json();
    if (!(info.visibility ? info.visibility === 'private' : info.private)) throw new SyncError('public');
    return info.full_name || repo;
  }

  return { syncNow, checkRepo };
}
