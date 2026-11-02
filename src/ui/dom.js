// 小工具：建元素（文字一律用 textContent，不拼 HTML）、底部面板、提示条。

/**
 * h('div.card', { onclick, title }, '文字', 子元素, [数组也行], null 跳过)
 * 标签名后面可以跟 .class；attrs 里 on* 是事件，class/style/dataset 特殊处理，其余写成属性
 */
export function h(tag, attrs, ...kids) {
  if (attrs == null || typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs)) { kids.unshift(attrs); attrs = {}; }
  const [name, ...cls] = tag.split('.');
  const el = name === 'svg' || attrs.svg ? document.createElementNS('http://www.w3.org/2000/svg', name) : document.createElement(name || 'div');
  if (cls.length) el.setAttribute('class', cls.join(' '));
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false || k === 'svg') continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.setAttribute('class', ((el.getAttribute('class') || '') + ' ' + v).trim());
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'value' || k === 'checked' || k === 'selected' || k === 'disabled' || k === 'hidden') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, kids);
  return el;
}
function append(el, kids) {
  for (const k of kids) {
    if (k == null || k === false) continue;
    if (Array.isArray(k)) append(el, k);
    else el.appendChild(k instanceof Node ? k : document.createTextNode(String(k)));
  }
}
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// ---------- 提示条 ----------
let toastTimer = null;
export function toast(msg, { action, onAction, ms = 4000 } = {}) {
  let el = $('#toast');
  if (!el) { el = h('div', { id: 'toast', role: 'status' }); document.body.appendChild(el); }
  el.replaceChildren(h('span', null, msg));
  if (action) el.appendChild(h('button', { type: 'button', onclick: () => { el.classList.remove('on'); onAction(); } }, action));
  el.classList.add('on');
  el.removeAttribute('inert');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.classList.remove('on'); el.setAttribute('inert', ''); setTimeout(() => { if (!el.classList.contains('on')) el.replaceChildren(); }, 300); }, ms);
}

// ---------- 面板（手机上从底部弹出，大屏居中） ----------
/**
 * openSheet({ title, body: Node | (sheet) => Node, foot: [按钮…], wide, onClose })
 * 返回 { el, body, close }
 */
export function openSheet({ title, body, foot, wide, onClose, beforeClose, closeLabel = 'Close' }) {
  const dlg = h('dialog.sheet' + (wide ? '.wide' : ''), { 'aria-label': title });
  const bodyEl = h('div.sheet-body');
  const close = () => { if (dlg.open) dlg.close(); };
  const tryClose = () => { if (!beforeClose || beforeClose() !== false) close(); };   // beforeClose 返回 false 时不关（比如有没保存的修改）
  const titleEl = h('h2', null, title);
  dlg.append(
    h('div.sheet-head', null, titleEl, h('button.icon-btn', { type: 'button', 'aria-label': closeLabel, onclick: tryClose }, '✕')),
    bodyEl,
  );
  dlg.addEventListener('cancel', e => { e.preventDefault(); tryClose(); });
  const sheet = { el: dlg, body: bodyEl, close, tryClose, setTitle: (x) => { titleEl.textContent = x; } };
  const content = typeof body === 'function' ? body(sheet) : body;
  if (content) bodyEl.append(content);
  if (foot && foot.length) dlg.append(h('div.sheet-foot', null, foot));
  dlg.addEventListener('close', () => { dlg.remove(); if (onClose) onClose(); });
  // 点遮罩关闭：按下和松开都在遮罩上才算（在输入框里拖选文字、松手落到遮罩上不算）
  let downOnBackdrop = false;
  dlg.addEventListener('pointerdown', e => { downOnBackdrop = e.target === dlg; });
  dlg.addEventListener('click', e => { if (e.target === dlg && downOnBackdrop) tryClose(); downOnBackdrop = false; });
  document.body.appendChild(dlg);
  dlg.showModal();
  return sheet;
}

/** 金额输入框旁边的「±」：iPhone 的数字键盘没有负号（退款、减免、抵扣要用负数） */
export function signButton(input, label = '±') {
  return h('button.icon-btn.sign-btn', { type: 'button', 'aria-label': label, title: label, onclick: () => {
    const v = input.value.trim();
    input.value = v.startsWith('-') || v.startsWith('−') ? v.slice(1) : '-' + (v || '');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
  } }, '±');
}

/** 复制文字（不行就退回到选中文本框） */
export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch (e) { /* 退回下面的办法 */ }
  const ta = h('textarea', { style: { position: 'fixed', opacity: '0' } });
  ta.value = text; document.body.appendChild(ta); ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
  ta.remove();
  return ok;
}

/** 下载一个文件（备份、CSV、日历） */
export function download(name, text, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h('a', { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
