import test from 'node:test';
import assert from 'node:assert/strict';
import { axisDomain, columnBounds } from '../src/ui/charts.js';

const series = (...values) => values.map(values => ({ values }));

test('堆叠图的轴范围分别计正负分项，不能用净额掩盖退款或费用峰值', () => {
  const bounds = columnBounds(series([80, 20], [40, -50], [-15, -20]), true);
  assert.deepEqual(bounds, [{ min: -15, max: 120 }, { min: -70, max: 20 }]);
  const auto = axisDomain(-70, 120);
  assert.ok(auto.y0 <= -70 && auto.y1 >= 120);
  assert.ok(auto.ticks.includes(0));
});

test('并排柱使用各自数值，缺失值和零分别保留', () => {
  assert.deepEqual(columnBounds(series([80, null, 0], [40, undefined, null])), [
    { min: 40, max: 80 }, null, { min: 0, max: 0 },
  ]);
  assert.deepEqual(columnBounds([]), []);
  const empty = axisDomain(0, 0);
  assert.ok(empty.y1 > empty.y0 && empty.ticks.every(Number.isFinite));
});

test('手动上下限精确生效，支持非零起点、负数和小数', () => {
  for (const limits of [{ min: 0, max: 500 }, { min: 40, max: 100 }, { min: -15, max: 65 }, { min: 0.1, max: 0.3 }]) {
    const d = axisDomain(-70, 120, 4, limits);
    assert.equal(d.y0, limits.min); assert.equal(d.y1, limits.max);
    assert.equal(d.ticks[0], limits.min); assert.equal(d.ticks.at(-1), limits.max);
    if (limits.min < 0 && limits.max > 0) assert.ok(d.ticks.includes(0));
    assert.ok(d.ticks.every((v, i) => Number.isFinite(v) && (i === 0 || v > d.ticks[i - 1])));
  }
  assert.deepEqual(axisDomain(-70, 120, 4, null), axisDomain(-70, 120));
});
