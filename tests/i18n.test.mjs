import test from 'node:test';
import assert from 'node:assert/strict';
import { date, period, setLang, t } from '../src/i18n.js';
import { STRINGS } from '../src/strings.js';

test('中英文包含相同的文案键，字符串中的动态字段对应一致', () => {
  const zh = STRINGS['zh-Hans'], en = STRINGS.en;
  assert.deepEqual(Object.keys(zh).sort(), Object.keys(en).sort());
  const fields = s => [...s.matchAll(/\{(\w+)\}/g)].map(x => x[1]).sort();
  for (const key of Object.keys(zh)) {
    assert.ok(zh[key] && en[key], key);
    if (typeof zh[key] === 'string' && typeof en[key] === 'string') assert.deepEqual(fields(zh[key]), fields(en[key]), key);
  }
});

test('账单日期统一为完整固定宽度格式，中英界面一致', () => {
  for (const lang of ['zh-Hans', 'en']) {
    setLang(lang);
    assert.equal(date('2026-01-02', 'iso'), '2026-01-02');
    assert.equal(period('2025-12-03', '2026-01-01', 'iso'), '2025-12-03 – 2026-01-01');
    assert.equal(date(null, 'iso'), '—');
    assert.ok(t('u.allHistory', { n: 52, from: '2022-07-11', to: '2026-10-08' }).includes('2022-07-11'));
  }
});

test('中文网络分类使用同一术语', () => {
  setLang('zh-Hans');
  assert.equal(t('cat.internet'), t('splitcat.internet'));
  assert.equal(t('u.internet'), t('cat.internet'));
});

test('英文账单数量使用正确的单复数', () => {
  setLang('en');
  for (const key of ['u.allHistory', 'bills.providerCostNote']) {
    assert.match(t(key, { n: 1, from: '2026-01-01', to: '2026-01-01' }), /^All 1 bill\b/);
    assert.doesNotMatch(t(key, { n: 1 }), /1 bills\b/);
    assert.match(t(key, { n: 12, from: '2025-01-01', to: '2026-01-01' }), /^All 12 bills\b/);
  }
});

test('PDF 页数和关联进度不使用金额格式', () => {
  setLang('zh-Hans');
  assert.equal(t('pdf.page', { n: 1, total: 4 }), '第 1/4 页');
  assert.equal(t('pdf.progress', { n: 1, total: 45 }), '正在关联 1/45…');
  setLang('en');
  assert.equal(t('pdf.page', { n: 1, total: 4 }), 'Page 1/4');
});
