// service worker 预缓存的文件表要和仓库里的程序文件一致（加了新模块忘记写进去，离线时就会打不开）
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
test('sw.js 的 CORE 包含全部程序文件，而且每个文件都存在', () => {
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  const core = [...sw.match(/const CORE = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
  const js = [];
  (function walk(d) { for (const f of fs.readdirSync(path.join(root, d))) { const p = d + '/' + f; if (fs.statSync(path.join(root, p)).isDirectory()) walk(p); else if (f.endsWith('.js')) js.push('./' + p); } })('src');
  for (const f of js) assert.ok(core.includes(f), `${f} 没有写进 sw.js 的 CORE`);
  for (const f of core) if (f !== './') assert.ok(fs.existsSync(path.join(root, f)), `CORE 里的 ${f} 不存在`);
});
