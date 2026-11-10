// 自己画的 SVG 图表：柱状图（可堆叠）、折线图、迷你趋势线。
// 柱宽默认 ≤24px；账单图按每屏账单数自适应（≤48px）。顶端 4px 圆角、底部方角；堆叠各段留 2px 底色空隙。
// 折线 2px，末端圆点 r=4 带 2px 底色描边；网格和坐标轴是一像素的实线细线；
// 两个以上系列一定有图例；悬停/键盘聚焦时一个提示框列出该位置的所有系列；每张图都能切换成表格。
// 所有名称都用 textContent 写入，不拼 HTML。
import { h, openSheet } from './dom.js';
import { t } from '../i18n.js';

const NS = 'http://www.w3.org/2000/svg';
let plotId = 0;
const axisNumber = new Intl.NumberFormat('en-US', { maximumFractionDigits: 8 });
const svgEl = (tag, attrs = {}, parent) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  if (parent) parent.appendChild(el);
  return el;
};
const htmlEl = (tag, cls, parent, text) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text != null) el.textContent = text;
  if (parent) parent.appendChild(el);
  return el;
};

/** 纵轴范围：小小的负数（比如一个月的气候补贴）不把轴拉到下一整格，最低刻度停在 0，柱子略微伸出去 */
export function axisDomain(min, max, count = 4, limits = null) {
  if (limits) {
    const { min: y0, max: y1 } = limits;
    let ticks = Array.from({ length: count + 1 }, (_, i) => i === count ? y1 : y0 + (y1 - y0) * (i / count));
    // 正负值共用一张图时保留 0 基线，临近 0 的标签让位，避免重叠。
    if (y0 < 0 && y1 > 0 && !ticks.includes(0)) ticks = [...ticks.filter(v => Math.abs(v) > (y1 - y0) / count * 0.4), 0].sort((a, b) => a - b);
    return { ticks, y0, y1 };
  }
  let ticks = niceTicks(min, max, count);
  const step = ticks[1] - ticks[0];
  let y0 = ticks[0];
  if (min < 0 && ticks[0] < min - step * 0.5) { y0 = min - step * 0.08; ticks = ticks.filter(v => v >= y0); }
  return { ticks, y0, y1: ticks[ticks.length - 1] };
}

/** 每组柱子的实际端点：堆叠时正负分别相加，空缺不当作 0。 */
export function columnBounds(series, stacked = false) {
  return Array.from({ length: Math.max(0, ...series.map(s => s.values.length)) }, (_, i) => {
    const values = series.map(s => s.values[i]).filter(Number.isFinite);
    if (!values.length) return null;
    if (!stacked) return { min: Math.min(...values), max: Math.max(...values) };
    const pos = values.filter(v => v > 0).reduce((a, v) => a + v, 0);
    const neg = values.filter(v => v < 0).reduce((a, v) => a + v, 0);
    return { min: neg < 0 ? neg : pos, max: pos > 0 ? pos : neg };
  });
}

/** 刻度：取「好看」的整数间隔（1、2、2.5、5 × 10^n） */
export function niceTicks(min, max, count = 4) {
  if (!(max > min)) { max = min + 1; }
  const span = max - min, raw = span / count, mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw) || 10 * mag;
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step, ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(+(Math.round(v / step) * step).toPrecision(12));
  return ticks;
}

// 提示框：整页共用一个
let tipEl = null;
function tip() {
  if (!tipEl) { tipEl = htmlEl('div', 'viz-tip', document.body); tipEl.setAttribute('role', 'status'); tipEl.hidden = true; }
  return tipEl;
}
function showTip(x, y, title, rows, total) {
  const t = tip();
  t.replaceChildren();
  htmlEl('div', 'viz-tip-title', t, title);
  for (const r of rows) {
    const row = htmlEl('div', 'viz-tip-row', t);
    const key = htmlEl('span', 'viz-key ' + (r.kind || 'line'), row);
    key.style.setProperty('--k', r.color);
    htmlEl('strong', null, row, r.value);
    htmlEl('span', 'viz-tip-name', row, r.name);
  }
  if (total) { const row = htmlEl('div', 'viz-tip-row viz-tip-total', t); htmlEl('strong', null, row, total.value); htmlEl('span', 'viz-tip-name', row, total.name); }
  t.hidden = false;
  const w = t.offsetWidth, h = t.offsetHeight, vw = window.innerWidth, vh = window.innerHeight;
  t.style.left = Math.max(8, Math.min(vw - w - 8, x + 14)) + 'px';
  t.style.top = Math.max(8, Math.min(vh - h - 8, y - h - 12 < 8 ? y + 16 : y - h - 12)) + 'px';
}
const hideTip = () => { if (tipEl) tipEl.hidden = true; };

/** 图表外壳：标题、图例、切换表格、尺寸变化时重画 */
function frame(container, opts, drawPlot, legendKind) {
  container.replaceChildren();
  container.classList.add('viz');
  const head = htmlEl('div', 'viz-head', container);
  if (opts.title) htmlEl('div', 'viz-title', head, opts.title);
  const actions = htmlEl('div', 'viz-actions', head);
  let limits = null, domain = null;
  const scale = legendKind === 'bar' ? htmlEl('button', 'viz-toggle', actions, t('viz.axisAuto')) : null;
  if (scale) {
    scale.type = 'button';
    scale.setAttribute('aria-haspopup', 'dialog');
    scale.onclick = () => {
      const min = h('input', { type: 'number', step: 'any', value: domain.y0, required: true });
      const max = h('input', { type: 'number', step: 'any', value: domain.y1, required: true });
      const err = h('p.err', { hidden: true, role: 'alert' });
      const field = (label, input) => h('label.field', null, h('span.field-label', null, label), input);
      const set = next => { limits = next; draw(true); sheet.close(); };
      const sheet = openSheet({ title: t('viz.axisTitle'), body: h('div.form', null,
        h('p', null, opts.title || ''),
        h('div.field-row', null, field(t('viz.axisMin'), min), field(t('viz.axisMax'), max)),
        h('p.note', null, t('viz.axisHint')), err),
        foot: [h('button.btn.axis-reset', { type: 'button', onclick: () => set(null) }, t('viz.axisReset')),
          h('button.btn', { type: 'button', onclick: () => sheet.close() }, t('cancel')),
          h('button.btn.primary', { type: 'button', onclick: () => {
            const lo = min.valueAsNumber, hi = max.valueAsNumber;
            if (!Number.isFinite(lo) || !Number.isFinite(hi) || !(hi > lo) || !Number.isFinite(hi - lo)) {
              err.textContent = t('viz.axisInvalid'); err.hidden = false; return;
            }
            set({ min: lo, max: hi });
          } }, t('viz.axisApply'))] });
      sheet.el.classList.add('axis-sheet');
    };
  }
  const toggle = htmlEl('button', 'viz-toggle', actions, opts.tableLabel || 'Table');
  toggle.type = 'button';
  toggle.setAttribute('aria-pressed', 'false');
  const shown = opts.series.filter(s => !s.hideInLegend);
  if (shown.length >= 2) {
    const lg = htmlEl('div', 'viz-legend', container);
    for (const s of shown) {
      const it = htmlEl('span', 'viz-legend-item', lg);
      htmlEl('span', 'viz-key ' + (s.muted ? 'line muted' : legendKind), it).style.setProperty('--k', s.color);
      htmlEl('span', null, it, s.name);
    }
  }
  const plot = htmlEl('div', 'viz-plot', container);
  if (opts.visibleCount) plot.classList.add('viz-scroll');
  const scaleNote = scale ? htmlEl('p', 'note viz-scale-note', container) : null;
  if (scaleNote) scaleNote.hidden = true;
  const table = htmlEl('div', 'viz-table', container);
  table.hidden = true;
  toggle.onclick = () => {
    const on = table.hidden;
    table.hidden = !on; plot.hidden = on;
    if (scale) { scale.disabled = on; scaleNote.hidden = on || !limits; }
    toggle.setAttribute('aria-pressed', String(on));
    if (on) renderTable(table, opts);
  };
  let lastW = 0;
  const draw = (force = false) => {
    const w = plot.clientWidth || container.clientWidth || 600;
    if (w === lastW && !force) return;
    lastW = w;
    const scroll = plot.scrollLeft;
    if (force) hideTip();
    domain = drawPlot(plot, w, limits);
    if (scale) {
      scale.textContent = t(limits ? 'viz.axisCustom' : 'viz.axisAuto');
      scale.setAttribute('aria-pressed', String(!!limits));
      scaleNote.hidden = !limits || plot.hidden;
      scaleNote.textContent = limits ? [t('viz.axisRange', { from: axisNumber.format(limits.min), to: axisNumber.format(limits.max) }),
        limits.min > 0 || limits.max < 0 ? t('viz.axisNonzero') : '', domain.clipped ? t('viz.axisClipped', { n: domain.clipped }) : ''].filter(Boolean).join(' ') : '';
    }
    if (opts.visibleCount) plot.scrollLeft = force ? scroll : plot.scrollWidth;
  };
  draw();
  if (window.ResizeObserver) {
    if (container._ro) container._ro.disconnect();
    container._ro = new ResizeObserver(() => draw());
    container._ro.observe(plot);
  }
}

function renderTable(el, opts) {
  el.replaceChildren();
  const t = htmlEl('table', 'viz-data-table', el);
  const head = htmlEl('tr', null, htmlEl('thead', null, t));
  htmlEl('th', null, head, opts.xName || '');
  for (const s of opts.series) htmlEl('th', 'num', head, s.name);
  if (opts.stacked && opts.series.length > 1) htmlEl('th', 'num', head, opts.totalLabel || 'Total');
  const body = htmlEl('tbody', null, t);
  opts.labels.forEach((lab, i) => {
    const tr = htmlEl('tr', null, body);
    htmlEl('th', null, tr, opts.longLabels ? opts.longLabels[i] : lab);
    let sum = 0, any = false;
    for (const s of opts.series) {
      const v = s.values[i];
      if (v != null) { sum += v; any = true; }
      htmlEl('td', 'num', tr, v == null ? '—' : opts.format(v));
    }
    if (opts.stacked && opts.series.length > 1) htmlEl('td', 'num', tr, any ? opts.format(sum) : '—');
  });
}

const PAD = { top: 10, right: 12, bottom: 26, left: 52 };

/**
 * 柱状图。
 * opts: { labels, longLabels?, series: [{ key, name, color, values }], stacked, format(v), tickFormat(v), visibleCount?, height?, title?, onSelect?(i), selected? }
 */
export function columnChart(container, opts) {
  frame(container, opts, (plot, viewportWidth, limits) => {
    plot.replaceChildren();
    const bounds = columnBounds(opts.series, opts.stacked);
    const min = Math.min(0, ...bounds.filter(Boolean).map(b => b.min)), max = Math.max(0, ...bounds.filter(Boolean).map(b => b.max));
    const domain = axisDomain(min, max, 4, limits), { ticks, y0, y1 } = domain;
    const tickFormat = limits ? v => axisNumber.format(v) : opts.tickFormat;
    const left = limits ? Math.min(120, Math.max(PAD.left, ...ticks.map(v => tickFormat(v).length * 7 + 10))) : PAD.left;
    const n = opts.labels.length, count = Math.max(1, Math.min(n, opts.visibleCount || n));
    const width = opts.visibleCount ? (viewportWidth - left - PAD.right) * n / count + left + PAD.right : viewportWidth;
    const iw = Math.max(40, width - left - PAD.right), band = iw / Math.max(1, n);
    const verticalLabels = opts.visibleCount && band < 48;
    const H = (opts.height || 220) + (verticalLabels ? 38 : 0), bottom = PAD.bottom + (verticalLabels ? 38 : 0);
    const ih = H - PAD.top - bottom;
    const Y = v => PAD.top + ih - (v - y0) / (y1 - y0) * ih;
    const svg = svgEl('svg', { width, height: H, viewBox: `0 0 ${width} ${H}`, role: 'img', 'aria-label': opts.ariaLabel || opts.title || '' }, plot);
    const clipId = 'viz-columns-' + ++plotId;
    const clip = svgEl('clipPath', { id: clipId }, svgEl('defs', {}, svg));
    svgEl('rect', { x: left, y: PAD.top, width: iw, height: ih }, clip);
    for (const tv of ticks) {
      svgEl('line', { x1: left, x2: left + iw, y1: Y(tv), y2: Y(tv), class: tv === 0 ? 'viz-base' : 'viz-grid' }, svg);
      if (!opts.visibleCount) svgEl('text', { x: left - 6, y: Y(tv) + 4, 'text-anchor': 'end', class: 'viz-tick' }, svg).textContent = tickFormat(tv);
    }
    const slots = opts.stacked ? 1 : opts.series.length;
    const gap = opts.visibleCount && band >= 48 ? 4 : 2;
    const barW = opts.visibleCount ? Math.max(1, Math.min(48, (band * 2 / 3 - (slots - 1) * gap) / slots))
      : Math.max(3, Math.min(24, band - 2, opts.stacked ? band * 0.62 : band * 0.8 / opts.series.length));
    const labelEvery = opts.visibleCount ? 1 : Math.max(1, Math.ceil(n / Math.max(1, Math.floor(iw / 46))));
    const groups = [];
    for (let i = 0; i < n; i++) {
      const cx = left + band * i + band / 2;
      const g = svgEl('g', { 'clip-path': `url(#${clipId})`, class: 'viz-col' + (opts.selected === i ? ' sel' : '') + (opts.partial && opts.partial[i] ? ' partial' : '') }, svg);
      groups.push(g);
      const segs = opts.series.map((s, si) => ({ s, si, v: s.values[i] })).filter(x => x.v);
      if (opts.stacked) {
        let up = 0, down = 0;
        const pos = segs.filter(x => x.v > 0), neg = segs.filter(x => x.v < 0);
        // 极小分项可能不足半像素而不绘制，圆角应落在最外侧实际可见的分段上。
        const top = pos.map((x, k) => Y(0) - Y(x.v) - (k > 0 ? 2 : 0) > 0.5).lastIndexOf(true);
        const bottom = neg.map((x, k) => Y(x.v) - Y(0) - (k > 0 ? 2 : 0) > 0.5).lastIndexOf(true);
        pos.forEach((x, k) => { drawBar(g, cx - barW / 2, Y(up + x.v), barW, Y(up) - Y(up + x.v), x.s.color, k === top ? 'top' : 'none', k > 0); up += x.v; });
        neg.forEach((x, k) => { drawBar(g, cx - barW / 2, Y(down), barW, Y(down + x.v) - Y(down), x.s.color, k === bottom ? 'bottom' : 'none', k > 0, true); down += x.v; });
      } else {
        const w = barW, off = (segs.length * (w + gap) - gap) / 2;
        segs.forEach((x, k) => { const v = x.v; drawBar(g, cx - off + k * (w + gap), Y(Math.max(0, v)), w, Math.abs(Y(v) - Y(0)), x.s.color, v >= 0 ? 'top' : 'bottom', false); });
      }
      if (i % labelEvery === 0) {
        const y = verticalLabels ? H - bottom + 8 : H - 8;
        svgEl('text', { x: cx, y, 'text-anchor': verticalLabels ? 'end' : 'middle',
          transform: verticalLabels ? `rotate(-90,${cx},${y})` : null, class: 'viz-tick' }, svg).textContent = opts.labels[i];
      }
      if (limits && bounds[i]) {
        for (const [direction, outside, y, dy] of [['up', bounds[i].max > y1, PAD.top + 1, 6], ['down', bounds[i].min < y0, PAD.top + ih - 1, -6]]) {
          if (outside) svgEl('path', { class: 'viz-overflow ' + direction, d: `M${cx},${y}l-4,${dy}h8Z`, 'aria-hidden': 'true' }, svg);
        }
      }
      // 命中区域：整条竖带，比柱子宽
      const hit = svgEl('rect', { x: left + band * i, y: PAD.top, width: band, height: ih, class: 'viz-hit', tabindex: '0', role: 'button',
        'aria-label': `${opts.longLabels ? opts.longLabels[i] : opts.labels[i]}` }, svg);
      const show = (ev) => {
        groups.forEach(gg => gg.classList.remove('hover')); g.classList.add('hover');
        const rows = opts.series.filter(s => s.values[i] != null).map(s => ({ color: s.color, kind: 'bar', name: s.name, value: opts.format(s.values[i]) }));
        const total = opts.stacked && rows.length > 1 ? { name: opts.totalLabel || 'Total', value: opts.format(opts.series.reduce((a, s) => a + (s.values[i] || 0), 0)) } : null;
        const r = ev && ev.clientX != null ? { x: ev.clientX, y: ev.clientY } : (() => { const b = hit.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + 20 }; })();
        showTip(r.x, r.y, opts.longLabels ? opts.longLabels[i] : opts.labels[i], rows.reverse(), total);
      };
      hit.addEventListener('pointermove', show);
      hit.addEventListener('focus', () => show());
      hit.addEventListener('pointerleave', () => { g.classList.remove('hover'); hideTip(); });
      hit.addEventListener('blur', () => { g.classList.remove('hover'); hideTip(); });
      hit.addEventListener('keydown', e => {
        const d = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
        if (d && svg.querySelectorAll('.viz-hit')[i + d]) { e.preventDefault(); svg.querySelectorAll('.viz-hit')[i + d].focus(); }
        if ((e.key === 'Enter' || e.key === ' ') && opts.onSelect) { e.preventDefault(); opts.onSelect(i); }
      });
      if (opts.onSelect) hit.addEventListener('click', () => opts.onSelect(i));
    }
    if (opts.visibleCount) {
      const axis = svgEl('g', { class: 'viz-y-axis', 'aria-hidden': 'true', 'pointer-events': 'none' }, svg);
      svgEl('rect', { width: left, height: H, fill: 'var(--surface)' }, axis);
      for (const tv of ticks) svgEl('text', { x: left - 6, y: Y(tv) + 4, 'text-anchor': 'end', class: 'viz-tick' }, axis).textContent = tickFormat(tv);
      plot.onscroll = () => axis.setAttribute('transform', `translate(${plot.scrollLeft},0)`);
      plot.onscroll();
    }
    return { ...domain, clipped: limits ? bounds.filter(b => b && (b.min < y0 || b.max > y1)).length : 0 };
  }, 'bar');
}

// 一段柱子：round = 'top' / 'bottom' / 'none'；gap 为 true 时在靠基线一侧留 2px 底色空隙
function drawBar(g, x, y, w, h, color, round, gap, negative = false) {
  if (gap) { if (negative) { y += 2; } h -= 2; }
  if (!(h > 0.5)) return;
  const r = Math.min(4, w / 2, h);
  let d;
  if (round === 'top') d = `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
  else if (round === 'bottom') d = `M${x},${y}V${y + h - r}Q${x},${y + h} ${x + r},${y + h}H${x + w - r}Q${x + w},${y + h} ${x + w},${y + h - r}V${y}Z`;
  else d = `M${x},${y}H${x + w}V${y + h}H${x}Z`;
  svgEl('path', { d, class: 'viz-bar', style: `fill:${color}` }, g);
}

/**
 * 折线图。
 * opts: { labels, longLabels?, series: [{ key, name, color, values, muted? }], format, tickFormat, height?, title?, zeroBased? }
 * 某条线 muted 时画成灰色（作对照，比如去年同期）；数据里的 null 会断开线
 */
export function lineChart(container, opts) {
  frame(container, opts, (plot, width) => {
    plot.replaceChildren();
    const H = opts.height || 220, n = opts.labels.length;
    const iw = Math.max(40, width - PAD.left - PAD.right), ih = H - PAD.top - PAD.bottom;
    const vals = opts.series.flatMap(s => s.values.filter(v => v != null));
    let min = Math.min(...vals), max = Math.max(...vals);
    if (opts.zeroBased !== false) min = Math.min(0, min);
    if (!vals.length) { min = 0; max = 1; }
    const ticks = niceTicks(min, max, 4), y0 = ticks[0], y1 = ticks[ticks.length - 1];
    const X = i => PAD.left + (n <= 1 ? iw / 2 : iw * i / (n - 1)), Y = v => PAD.top + ih - (v - y0) / (y1 - y0) * ih;
    const svg = svgEl('svg', { width, height: H, viewBox: `0 0 ${width} ${H}`, role: 'img', 'aria-label': opts.ariaLabel || opts.title || '' }, plot);
    for (const tv of ticks) {
      svgEl('line', { x1: PAD.left, x2: PAD.left + iw, y1: Y(tv), y2: Y(tv), class: tv === 0 ? 'viz-base' : 'viz-grid' }, svg);
      svgEl('text', { x: PAD.left - 6, y: Y(tv) + 4, 'text-anchor': 'end', class: 'viz-tick' }, svg).textContent = opts.tickFormat(tv);
    }
    const labelEvery = Math.max(1, Math.ceil(n / Math.floor(iw / 46)));
    opts.labels.forEach((lab, i) => { if (i % labelEvery === 0) svgEl('text', { x: X(i), y: H - 8, 'text-anchor': 'middle', class: 'viz-tick' }, svg).textContent = lab; });
    const ordered = [...opts.series.filter(s => s.muted), ...opts.series.filter(s => !s.muted)];
    for (const s of ordered) {
      let d = '', pen = false;
      s.values.forEach((v, i) => { if (v == null) { pen = false; return; } d += (pen ? 'L' : 'M') + X(i) + ',' + Y(v); pen = true; });
      svgEl('path', { d, class: 'viz-line' + (s.muted ? ' muted' : '') + (s.thin ? ' thin' : ''), style: s.muted ? null : `stroke:${s.color}` }, svg);
      const last = s.values.map((v, i) => [v, i]).filter(([v]) => v != null).pop();
      if (last && !s.muted && !s.thin) svgEl('circle', { cx: X(last[1]), cy: Y(last[0]), r: 4, class: 'viz-dot', style: `fill:${s.color}` }, svg);
    }
    const cross = svgEl('line', { y1: PAD.top, y2: PAD.top + ih, class: 'viz-cross', visibility: 'hidden' }, svg);
    const hover = svgEl('g', {}, svg);
    const hit = svgEl('rect', { x: PAD.left, y: PAD.top, width: iw, height: ih, class: 'viz-hit', tabindex: '0', role: 'button', 'aria-label': opts.title || '' }, svg);
    let cur = n - 1;
    const show = (i, ev) => {
      cur = Math.max(0, Math.min(n - 1, i));
      cross.setAttribute('x1', X(cur)); cross.setAttribute('x2', X(cur)); cross.setAttribute('visibility', 'visible');
      hover.replaceChildren();
      for (const s of opts.series) if (s.values[cur] != null) svgEl('circle', { cx: X(cur), cy: Y(s.values[cur]), r: 4, class: 'viz-dot', style: `fill:${s.muted ? 'var(--viz-muted)' : s.color}` }, hover);
      const rows = opts.series.filter(s => s.values[cur] != null).map(s => ({ color: s.muted ? 'var(--viz-muted)' : s.color, kind: 'line', name: s.name, value: opts.format(s.values[cur]) }));
      const b = hit.getBoundingClientRect();
      const p = ev && ev.clientX != null ? { x: ev.clientX, y: ev.clientY } : { x: b.left + (X(cur) - PAD.left) * b.width / iw, y: b.top + 20 };
      showTip(p.x, p.y, opts.longLabels ? opts.longLabels[cur] : opts.labels[cur], rows);
    };
    const idxAt = ev => { const b = hit.getBoundingClientRect(); return Math.round((ev.clientX - b.left) / b.width * (n - 1)); };
    hit.addEventListener('pointermove', ev => show(idxAt(ev), ev));
    hit.addEventListener('focus', () => show(cur));
    const leave = () => { cross.setAttribute('visibility', 'hidden'); hover.replaceChildren(); hideTip(); };
    hit.addEventListener('pointerleave', leave);
    hit.addEventListener('blur', leave);
    hit.addEventListener('keydown', e => { const d = { ArrowRight: 1, ArrowLeft: -1 }[e.key]; if (d) { e.preventDefault(); show(cur + d); } });
  }, 'line');
}

/** 迷你趋势线：最后一个点用强调色 */
export function sparkline(container, values, { width = 96, height = 28, color = 'var(--viz-accent)' } = {}) {
  container.replaceChildren();
  const vs = values.filter(v => v != null);
  if (vs.length < 2) return;
  const min = Math.min(...vs), max = Math.max(...vs), span = max - min || 1;
  const X = i => 2 + (width - 6) * i / (values.length - 1), Y = v => height - 3 - (v - min) / span * (height - 6);
  const svg = svgEl('svg', { width, height, viewBox: `0 0 ${width} ${height}`, 'aria-hidden': 'true', class: 'viz-spark' }, container);
  let d = '', pen = false;
  values.forEach((v, i) => { if (v == null) { pen = false; return; } d += (pen ? 'L' : 'M') + X(i) + ',' + Y(v); pen = true; });
  svgEl('path', { d, class: 'viz-line muted' }, svg);
  const li = values.length - 1;
  if (values[li] != null) svgEl('circle', { cx: X(li), cy: Y(values[li]), r: 3, style: `fill:${color}` }, svg);
}
