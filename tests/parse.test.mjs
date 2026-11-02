// parse.js 入口测试（合成文字）
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBillLines, looksReadable } from '../src/pdf/parse.js';

test('乱码文字层判为读不出来，正常英文但不认识的公司判为不认识', () => {
  const garbled = ['ÿþ÷ð¶ §¬ ®¯ ±²³ µ¶· ¸¹º »¼½ ¾¿À ÁÂÃ', 'ÄÅÆ ÇÈÉ ÊËÌ ÍÎÏ ÐÑÒ ÓÔÕ ÖØÙ ÚÛÜ ÝÞß'.repeat(20)];
  assert.equal(parseBillLines(garbled).reason, 'unreadable');
  const other = ['Acme Telephone Company', 'Your monthly statement', 'Account number 0000', 'Total amount due $12.00', 'Payment due date Jan 5, 2030', 'Thank you for your payment'];
  assert.equal(looksReadable(other.join('\n')), true);
  assert.equal(parseBillLines(other).reason, 'unknown-provider');
});
