import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSync, toB64, fromB64, SYNC_FILE } from '../src/core/sync.js';
import { blankState, stamp } from '../src/core/store.js';

// 一个最小的模拟 GitHub：一个文件、sha、409 冲突、ETag
function mockGitHub() {
  const gh = { file: null, sha: null, n: 0, puts: 0, log: [] };
  gh.fetch = async (url, opt) => {
    const m = opt.method || 'GET';
    gh.log.push(m);
    const json = (status, obj, headers = {}) => ({ status, ok: status >= 200 && status < 300, headers: { get: k => headers[k] || null }, json: async () => obj, text: async () => JSON.stringify(obj) });
    if (url.endsWith('/repos/me/data')) return json(200, { full_name: 'me/data', private: true });
    if (m === 'GET') {
      if (!gh.file) return json(404, {});
      if (opt.headers['If-None-Match'] === `"${gh.sha}"`) return json(304, null);
      return json(200, { sha: gh.sha, encoding: 'base64', content: gh.file }, { ETag: `"${gh.sha}"` });
    }
    const body = JSON.parse(opt.body);
    if (gh.file && body.sha !== gh.sha) return json(409, {});
    gh.file = body.content; gh.sha = 's' + (++gh.n); gh.puts++;
    return json(200, { content: { sha: gh.sha } });
  };
  gh.remote = () => JSON.parse(fromB64(gh.file));
  return gh;
}
function device(gh, name) {
  const d = { name, state: blankState(), version: 0, cfg: { repo: 'me/data', token: 't' }, applied: [] };
  d.sync = createSync({
    getState: () => d.state, applyRemote: (m, info) => { d.state = m; d.applied.push(info.device); },
    getConfig: () => d.cfg, saveConfig: () => {}, editVersion: () => d.version, device: name, fetch: (...a) => gh.fetch(...a),
  });
  const BILL = { providerId: 'p', statementDate: '2025-01-05', periodStart: '2025-01-01', periodEnd: '2025-02-01', total: 0 };   // 合法的最小账单
  d.edit = (id, fields) => { d.state.data.bills[id] = stamp({ ...BILL, id, ...fields }, d.state.data.bills[id]); d.version++; d.cfg.dirty = true; };
  return d;
}

test('base64 round trip keeps Chinese text', () => {
  assert.equal(fromB64(toB64('合租账本 ✓ $41.47')), '合租账本 ✓ $41.47');
});

test('two devices converge, each edit is uploaded once, and a stale copy is merged instead of overwritten', async () => {
  const gh = mockGitHub(), mac = device(gh, 'Mac'), ipad = device(gh, 'iPad');
  mac.edit('b1', { total: 10 });
  assert.equal((await mac.sync.syncNow()).ok, true);
  assert.equal(gh.puts, 1);
  await ipad.sync.syncNow();
  assert.equal(ipad.state.data.bills.b1.total, 10);
  assert.deepEqual(ipad.applied, ['Mac']);
  // 两边同时改不同的账单：后上传的那台会遇到 409，合并后再传
  ipad.edit('b2', { total: 20 });
  mac.edit('b3', { total: 30 });
  await ipad.sync.syncNow();
  await mac.sync.syncNow();
  await ipad.sync.syncNow();
  for (const d of [mac, ipad]) assert.deepEqual(Object.keys(d.state.data.bills).sort(), ['b1', 'b2', 'b3']);
  assert.deepEqual(Object.keys(gh.remote().state.data.bills).sort(), ['b1', 'b2', 'b3']);
  const puts = gh.puts;
  await mac.sync.syncNow(); await ipad.sync.syncNow();
  assert.equal(gh.puts, puts, 'nothing changed: no extra commits');
});

test('an edit made while uploading stays dirty for the next sync', async () => {
  const gh = mockGitHub(), mac = device(gh, 'Mac');
  const realFetch = gh.fetch;
  gh.fetch = async (url, opt) => { if (opt.method === 'PUT') mac.version++; return realFetch(url, opt); };
  mac.edit('b1', { total: 1 });
  await mac.sync.syncNow();
  assert.equal(mac.cfg.dirty, true);
});

test('errors are reported as codes; offline is not an error', async () => {
  const gh = mockGitHub(), mac = device(gh, 'Mac');
  gh.fetch = async () => { throw new TypeError('Load failed'); };
  const r = await mac.sync.syncNow();
  assert.equal(r.ok, false); assert.equal(r.offline, true); assert.equal(mac.cfg.err, null);
  gh.fetch = async () => ({ status: 401, ok: false, headers: { get: () => null }, json: async () => ({}) });
  assert.equal((await mac.sync.syncNow()).error.code, 'auth');
});

test('connecting refuses public repositories', async () => {
  const gh = mockGitHub(), mac = device(gh, 'Mac');
  assert.equal(await mac.sync.checkRepo('me/data', 't'), 'me/data');
  const pub = createSync({ getState: () => ({}), applyRemote() {}, getConfig: () => null, saveConfig() {}, editVersion: () => 0, device: 'x',
    fetch: async () => ({ status: 200, ok: true, headers: { get: () => null }, json: async () => ({ full_name: 'me/pub', private: false }) }) });
  await assert.rejects(pub.checkRepo('me/pub', 't'), e => e.code === 'public');
  assert.equal(SYNC_FILE, 'house-ledger.json');
});

test('仓库后来变成公开的：不再上传', async () => {
  const gh = mockGitHub();
  const realFetch = gh.fetch;
  let isPublic = false;
  gh.fetch = async (url, opt) => {
    if (url.endsWith('/repos/me/data')) return { status: 200, ok: true, headers: { get: () => null }, json: async () => ({ full_name: 'me/data', private: !isPublic, visibility: isPublic ? 'public' : 'private' }) };
    return realFetch(url, opt);
  };
  const mac = device(gh, 'Mac');
  mac.edit('b1', { total: 10 });
  assert.equal((await mac.sync.syncNow()).ok, true);
  const puts = gh.puts;
  isPublic = true;
  const mac2 = device(gh, 'Mac2');          // 新打开的 app（会重新检查）
  mac2.edit('b2', { total: 20 });
  const r = await mac2.sync.syncNow();
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'public');
  assert.equal(gh.puts, puts);
});
