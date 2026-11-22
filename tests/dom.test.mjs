// ui/dom.js 的确认框和面板的关闭检查：假 DOM（tests/helpers/dom.mjs）。全是编的文字
import test from 'node:test';
import assert from 'node:assert/strict';
import { installDom, find } from './helpers/dom.mjs';
import { confirmDialog, confirmDiscard, openSheet, h } from '../src/ui/dom.js';
import { setLang } from '../src/i18n.js';

const dialogs = doc => doc.body.children.filter(el => el.tag === 'dialog');
const top = doc => dialogs(doc).at(-1);
const button = (root, text) => find(root, el => el.tag === 'button' && el.textContent === text);

test('确认框：只有一句话时那句话就是名字；有标题时标题是名字、正文是说明；会删东西的红底按钮在「取消」后面，焦点先给「取消」', async () => {
  const env = installDom();
  try {
    setLang('zh-Hans');
    let p = confirmDialog({ message: '删除这张示例账单？', confirmLabel: '删除', danger: true });
    let d = top(env.doc);
    const msg = find(d, el => el.attrs.class === 'confirm-msg');
    assert.ok(d.classList.contains('confirm'));
    assert.equal(d.getAttribute('aria-label'), null);
    assert.equal(d.getAttribute('aria-labelledby'), msg.id);
    assert.equal(msg.textContent, '删除这张示例账单？');
    const foot = find(d, el => el.attrs.class === 'sheet-foot');
    const buttons = foot.children.filter(el => el.tag === 'button');
    assert.deepEqual(buttons.map(b => b.textContent), ['取消', '删除'], '先「取消」，再红色的删除');
    assert.equal(buttons[1].attrs.class, 'btn danger-fill');
    assert.equal(env.doc.activeElement, buttons[0], '连按两下回车不会直接删掉');
    button(d, '删除').click();
    assert.equal(await p, true);
    assert.equal(dialogs(env.doc).length, 0, '关掉后从页面上拿掉');

    p = confirmDialog({ title: '删除备注', message: ['第一段说明', '第二段说明'], confirmLabel: '删除', danger: true });
    d = top(env.doc);
    assert.equal(d.getAttribute('aria-label'), '删除备注');
    assert.equal(d.getAttribute('aria-describedby'), find(d, el => el.attrs.class === 'confirm-msg').id);
    assert.equal(find(d, el => el.attrs.class === 'confirm-msg').children.length, 2);
    button(d, '取消').click();
    assert.equal(await p, false);

    // Esc（dialog 的 cancel 事件）等于取消
    p = confirmDialog({ message: '停止同步？', confirmLabel: '停止同步', danger: true });
    const esc = top(env.doc).fire('cancel');
    assert.ok(esc.defaultPrevented);
    assert.equal(await p, false);

    // 不会丢东西的：焦点给确定，按钮是普通的主按钮
    p = confirmDialog({ message: '归为房租？', confirmLabel: '确定' });
    d = top(env.doc);
    assert.equal(env.doc.activeElement, button(d, '确定'));
    assert.equal(button(d, '确定').attrs.class, 'btn primary');
    button(d, '确定').click();
    assert.equal(await p, true);
  } finally { env.restore(); }
});

test('确认框三种语言：默认按钮文字跟着界面语言', async () => {
  const env = installDom();
  try {
    for (const [lang, cancel, ok] of [['zh-Hans', '取消', '确定'], ['zh-Hant-TW', '取消', '確定'], ['en', 'Cancel', 'OK']]) {
      setLang(lang);
      const p = confirmDialog('示例问题');
      const d = top(env.doc);
      assert.ok(button(d, cancel) && button(d, ok), lang);
      button(d, cancel).click();
      assert.equal(await p, false);
    }
  } finally { setLang('zh-Hans'); env.restore(); }
});

test('有没保存的修改：beforeClose 可以返回 App 里的确认框；选「取消」面板留着，选「放弃修改」才关；问着的时候再按 Esc 不再问第二遍', async () => {
  const env = installDom();
  try {
    setLang('zh-Hans');
    let asked = 0, closed = 0;
    const sheet = openSheet({ title: '编辑示例住户', body: h('p', null, '示例内容'), onClose: () => { closed++; },
      beforeClose: () => { asked++; return confirmDialog({ message: '放弃没保存的修改？', confirmLabel: '放弃修改', danger: true }); } });
    sheet.tryClose();
    assert.equal(dialogs(env.doc).length, 2, '确认框盖在面板上面');
    sheet.el.fire('cancel');
    assert.equal(asked, 1, '已经在问了：不再弹第二个');
    button(top(env.doc), '取消').click();
    await new Promise(r => setTimeout(r, 0));
    assert.ok(sheet.el.open, '选了取消：面板还开着');
    assert.equal(closed, 0);

    sheet.tryClose();
    button(top(env.doc), '放弃修改').click();
    await new Promise(r => setTimeout(r, 0));
    assert.equal(sheet.el.open, false);
    assert.equal(closed, 1);
    assert.equal(asked, 2);

    // 同步返回的 true / false 照旧
    const plain = openSheet({ title: '示例', body: h('p', null, '示例'), beforeClose: () => false });
    plain.tryClose();
    assert.ok(plain.el.open);
    plain.close();
    assert.equal(plain.el.open, false);
  } finally { env.restore(); }
});

test('Esc 是自己处理的（keydown），不交给浏览器关 dialog：确认框里按 Esc 只关确认框，面板和没保存的修改都还在；输入法选字时的 Esc 不管', async () => {
  const env = installDom();
  try {
    setLang('zh-Hans');
    let closed = 0;
    const sheet = openSheet({ title: '编辑示例账单', body: h('p', null, '示例内容'), onClose: () => { closed++; }, beforeClose: () => confirmDiscard() });
    const ime = sheet.el.fire('keydown', { key: 'Escape', isComposing: true });
    assert.ok(!ime.defaultPrevented, '输入法选字时的 Esc 留给输入法');
    assert.equal(dialogs(env.doc).length, 1);

    const esc = sheet.el.fire('keydown', { key: 'Escape' });
    assert.ok(esc.defaultPrevented, '浏览器不再自己去关面板（Chrome 连按 Esc 时拦不住 cancel）');
    assert.equal(dialogs(env.doc).length, 2, '先问');
    const ask = top(env.doc);
    assert.deepEqual(find(ask, el => el.attrs.class === 'sheet-foot').children.filter(el => el.tag === 'button').map(b => b.textContent), ['继续编辑', '放弃']);
    assert.equal(env.doc.activeElement, button(ask, '继续编辑'), '焦点在「继续编辑」上');
    sheet.el.fire('keydown', { key: 'Escape' });
    assert.equal(dialogs(env.doc).length, 2, '问着的时候不再问第二遍');

    const esc2 = ask.fire('keydown', { key: 'Escape' });
    assert.ok(esc2.defaultPrevented);
    await new Promise(r => setTimeout(r, 0));
    assert.equal(dialogs(env.doc).length, 1, '只关了确认框');
    assert.ok(sheet.el.open, '面板还开着');
    assert.equal(closed, 0);

    sheet.el.fire('keydown', { key: 'Escape' });
    button(top(env.doc), '放弃').click();
    await new Promise(r => setTimeout(r, 0));
    assert.equal(sheet.el.open, false);
    assert.equal(closed, 1);
  } finally { env.restore(); }
});

test('放弃没保存的修改：三种语言的按钮', async () => {
  const env = installDom();
  try {
    for (const [lang, keep, discard] of [['zh-Hans', '继续编辑', '放弃'], ['zh-Hant-TW', '繼續編輯', '放棄'], ['en', 'Keep editing', 'Discard']]) {
      setLang(lang);
      const p = confirmDiscard();
      const d = top(env.doc);
      assert.equal(env.doc.activeElement, button(d, keep), lang);
      assert.equal(button(d, discard).attrs.class, 'btn danger-fill', lang);
      button(d, keep).click();
      assert.equal(await p, false);
    }
  } finally { setLang('zh-Hans'); env.restore(); }
});
