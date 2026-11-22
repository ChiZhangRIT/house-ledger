// service worker 预缓存的文件表要和仓库里的程序文件一致（加了新模块忘记写进去，离线时就会打不开）
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUILD, newerBuild } from '../src/version.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
test('sw.js 的 CORE 包含全部程序文件，而且每个文件都存在', () => {
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  const core = [...sw.match(/const CORE = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
  const js = [];
  (function walk(d) { for (const f of fs.readdirSync(path.join(root, d))) { const p = d + '/' + f; if (fs.statSync(path.join(root, p)).isDirectory()) walk(p); else if (f.endsWith('.js')) js.push('./' + p); } })('src');
  for (const f of js) assert.ok(core.includes(f), `${f} 没有写进 sw.js 的 CORE`);
  for (const f of fs.readdirSync(root).filter(f => f.endsWith('.webmanifest'))) assert.ok(core.includes('./' + f), `${f} 没有写进 sw.js 的 CORE`);
  for (const f of core) if (f !== './') assert.ok(fs.existsSync(path.join(root, f)), `CORE 里的 ${f} 不存在`);
});

test('「关于」里的版本号（src/version.js）和 sw.js 的缓存名是同一个', () => {
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  assert.equal(sw.match(/const CACHE = '([^']+)'/)[1], BUILD);
  assert.match(BUILD, /^house-ledger-v\d+$/);
});

test('新版本下载好了：只有缓存里有比正在跑的这一份更新的版本才算', () => {
  assert.equal(newerBuild(['house-ledger-v24', 'house-ledger-v25'], 'house-ledger-v24'), true, '旧缓存还没删、新的已经装好');
  assert.equal(newerBuild(['house-ledger-v25'], 'house-ledger-v24'), true);
  assert.equal(newerBuild(['house-ledger-v24', 'house-ledger-v25'], 'house-ledger-v25'), false, '页面打开时已经拿到新代码，随后才换 worker');
  assert.equal(newerBuild(['house-ledger-v9'], 'house-ledger-v10'), false, '按数字比，不按字母');
  assert.equal(newerBuild(['picknest-v99', 'house-ledger-v24'], 'house-ledger-v24'), false, '同一个域名下别的 App 的缓存不算');
  assert.equal(newerBuild([], BUILD), false);
});
