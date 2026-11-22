// 最小的假 DOM：只够 ui/dom.js 的 h()、openSheet()、confirmDialog() 在 Node 里跑（<dialog> 的 showModal / close、焦点、事件）。
// 不碰浏览器、真实文件或账本数据
export class Element {
  constructor(tag) {
    this.tag = tag; this.tagName = tag.toUpperCase(); this.children = []; this.attrs = {}; this.style = {}; this.dataset = {}; this.events = {};
    this.parent = null; this.hidden = false; this.open = false; this._text = '';
  }
  setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'id') this.id = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  removeAttribute(k) { delete this.attrs[k]; }
  get classList() {
    const names = () => new Set((this.attrs.class || '').split(' ').filter(Boolean));
    const write = set => { this.attrs.class = [...set].join(' '); };
    return { contains: n => names().has(n), add: n => { const s = names(); s.add(n); write(s); }, remove: n => { const s = names(); s.delete(n); write(s); } };
  }
  appendChild(child) { if (child.parent) child.remove(); this.children.push(child); child.parent = this; return child; }
  append(...kids) { for (const k of kids) this.appendChild(k instanceof Element ? k : globalThis.document.createTextNode(String(k))); }
  replaceChildren(...kids) { for (const c of this.children) c.parent = null; this.children = []; this.append(...kids); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(c => c !== this); this.parent = null; }
  contains(el) { return this === el || this.children.some(c => c.contains(el)); }
  set textContent(v) { this._text = String(v); this.children = []; }
  get textContent() { return this._text + this.children.map(c => c.textContent).join(''); }
  addEventListener(type, fn) { (this.events[type] ||= []).push(fn); }
  removeEventListener(type, fn) { this.events[type] = (this.events[type] || []).filter(f => f !== fn); }
  fire(type, extra = {}) { const e = { type, target: this, preventDefault() { this.defaultPrevented = true; }, ...extra }; for (const fn of this.events[type] || []) fn(e); return e; }
  click() { return this.fire('click'); }
  focus() { globalThis.document.activeElement = this; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 400, height: 300 }; }
  // <dialog>：showModal 打开，close 关掉并发 close 事件（和浏览器一样同步发出，测试里够用）
  showModal() { this.open = true; }
  close() { if (!this.open) return; this.open = false; this.fire('close'); }
}
export const all = (el, pred) => [...(pred(el) ? [el] : []), ...el.children.flatMap(c => all(c, pred))];
export const find = (el, pred) => all(el, pred)[0] || null;

/** 装上假的 document / window / Node / ResizeObserver；返回 { doc, restore } */
export function installDom() {
  const doc = new Element('#document');
  doc.body = new Element('body'); doc.appendChild(doc.body); doc.activeElement = doc.body;
  doc.createElement = tag => new Element(tag);
  doc.createElementNS = (ns, tag) => new Element(tag);
  doc.createTextNode = text => { const n = new Element('#text'); n._text = String(text); return n; };
  const win = new Element('#window');
  const props = { document: doc, window: win, Node: Element, ResizeObserver: class { observe() {} disconnect() {} }, innerWidth: 1024, innerHeight: 800 };
  const saved = Object.fromEntries(Object.keys(props).map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  for (const [k, v] of Object.entries(props)) Object.defineProperty(globalThis, k, { configurable: true, writable: true, value: v });
  return {
    doc,
    restore() { for (const [k, d] of Object.entries(saved)) { if (d) Object.defineProperty(globalThis, k, d); else delete globalThis[k]; } },
  };
}
