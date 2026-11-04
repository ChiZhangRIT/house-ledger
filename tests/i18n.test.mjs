import test from 'node:test';
import assert from 'node:assert/strict';
import { date, period, setLang, t } from '../src/i18n.js';

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

test('PDF 页数和关联进度不使用金额格式', () => {
  setLang('zh-Hans');
  assert.equal(t('pdf.page', { n: 1, total: 4 }), '第 1/4 页');
  assert.equal(t('pdf.progress', { n: 1, total: 45 }), '正在关联 1/45…');
  setLang('en');
  assert.equal(t('pdf.page', { n: 1, total: 4 }), 'Page 1/4');
});
