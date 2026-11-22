import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSync, toB64, fromB64, SYNC_FILE, syncCode, parseSyncCode, tokenDaysLeft, tokenWarn, syncPhase, validTokenExp } from '../src/core/sync.js';
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

// ---------- 同步码和令牌到期日（令牌都是编的） ----------
test('同步码：可以带令牌到期日；旧版不带到期日的照样认，别的 App 的同步码不认', () => {
  assert.equal(syncCode('me/data', 'github_pat_example1', '2027-02-28'), 'house-ledger-sync:me/data:github_pat_example1:2027-02-28');
  assert.equal(syncCode('me/data', 'github_pat_example1', null), 'house-ledger-sync:me/data:github_pat_example1');
  assert.equal(syncCode('me/data', 'github_pat_example1', '0002-01-01'), 'house-ledger-sync:me/data:github_pat_example1', '键盘填了一半的年份不带上');
  assert.deepEqual(parseSyncCode(' house-ledger-sync:me/data:github_pat_example1:2027-02-28 '), { repo: 'me/data', token: 'github_pat_example1', exp: '2027-02-28' });
  assert.deepEqual(parseSyncCode('house-ledger-sync:me/data:github_pat_example1'), { repo: 'me/data', token: 'github_pat_example1', exp: null });
  assert.deepEqual(parseSyncCode('house-ledger-sync:me/data:github_pat_example1:2027-02-30'), { repo: 'me/data', token: 'github_pat_example1', exp: null }, '不存在的日期当成没带');
  assert.equal(parseSyncCode('picknest-sync:me/data:github_pat_example1'), null);
  assert.equal(parseSyncCode('house-ledger-sync:me/data:'), null);
  assert.equal(parseSyncCode('github_pat_example1'), null);
  for (const exp of [null, '2027-02-28']) {
    const code = syncCode('me/data', 'github_pat_example1', exp);
    assert.deepEqual(parseSyncCode(code), { repo: 'me/data', token: 'github_pat_example1', exp });
  }
});

test('令牌还有几天到期：按日历日算（跨夏令时也一样），两周内或已经过期才提醒', () => {
  assert.equal(tokenDaysLeft('2026-03-08', '2026-03-07'), 1);         // 美国夏令时开始那天只有 23 小时
  assert.equal(tokenDaysLeft('2026-11-01', '2026-10-31'), 1);
  assert.equal(tokenDaysLeft('2026-12-06', '2026-11-22'), 14);
  assert.equal(tokenDaysLeft('2026-11-22', '2026-11-22'), 0);
  assert.equal(tokenDaysLeft('2026-11-20', '2026-11-22'), -2);
  assert.equal(tokenDaysLeft(undefined, '2026-11-22'), null);
  assert.equal(tokenDaysLeft('2026-02-30', '2026-11-22'), null);
  assert.equal(tokenWarn('2026-12-06', '2026-11-22'), false, '还有 14 天：不提醒');
  assert.equal(tokenWarn('2026-12-05', '2026-11-22'), true, '还有 13 天：提醒');
  assert.equal(tokenWarn('2026-11-22', '2026-11-22'), true);
  assert.equal(tokenWarn('2026-10-01', '2026-11-22'), true, '已经过期：一直提醒');
  assert.equal(tokenWarn(null, '2026-11-22'), false);
  assert.equal(validTokenExp('2027-01-31'), true);
  assert.equal(validTokenExp('0020-01-31'), false);
  assert.equal(validTokenExp(''), false);
});

test('同步状态：出错、离线优先；令牌快到期排在待同步前面，变成黄色', () => {
  const today = '2026-11-22', soon = '2026-11-30';
  assert.equal(syncPhase(null, today), 'off');
  assert.equal(syncPhase({ err: { code: 'auth' }, tokenExp: soon }, today), 'err');
  assert.equal(syncPhase({ offline: true, tokenExp: soon }, today), 'offline');
  assert.equal(syncPhase({ dirty: true, tokenExp: soon }, today), 'token');
  assert.equal(syncPhase({ tokenExp: '2026-11-01' }, today), 'token');
  assert.equal(syncPhase({ dirty: true, tokenExp: '2027-06-01' }, today), 'pending');
  assert.equal(syncPhase({ tokenExp: '2027-06-01' }, today), 'ok');
  assert.equal(syncPhase({}, today), 'ok');
});

test('令牌和到期日只在本机设置里：不写进云端文件', async () => {
  const gh = mockGitHub(), mac = device(gh, 'Mac');
  mac.cfg.token = 'github_pat_example1'; mac.cfg.tokenExp = '2027-02-28';
  mac.edit('b1', { total: 10 });
  assert.equal((await mac.sync.syncNow()).ok, true);
  const text = fromB64(gh.file);
  assert.ok(!text.includes('github_pat_example1'));
  assert.ok(!text.includes('2027-02-28'));
  assert.ok(!('tokenExp' in gh.remote().state));
});
