// 离线缓存：有网时取最新版本（页面 3 秒内没响应就先用缓存），没网时用缓存。
// pdf.js 很大，不在安装时预先缓存；第一次读 PDF 时下载，之后也能离线用。
const CACHE = 'house-ledger-v1';
// 程序文件全部预先缓存（tests/sw.test.mjs 检查这张表和磁盘上的文件一致），第一次打开之后就能离线用
const CORE = ['./', './index.html', './styles.css', './manifest.webmanifest', './icons/icon-180.png', './icons/icon-512.png',
  './src/app.js', './src/core/alerts.js', './src/core/analytics.js', './src/core/checks.js', './src/core/dates.js', './src/core/ledger.js', './src/core/providers.js', './src/core/split.js', './src/core/statement.js', './src/core/store.js', './src/core/sync.js', './src/i18n.js', './src/pdf/loader.js', './src/pdf/parse.js', './src/pdf/parsers/att.js', './src/pdf/parsers/pge.js', './src/pdf/parsers/sunnyvale.js', './src/pdf/parsers/util.js', './src/pdf/parsers/xfinity.js', './src/pdf/text.js', './src/strings.js', './src/ui/charts.js', './src/ui/colors.js', './src/ui/dom.js', './src/ui/parse.js', './src/views/add.js', './src/views/analysis.js', './src/views/billDetail.js', './src/views/billForm.js', './src/views/bills.js', './src/views/collect.js', './src/views/money.js', './src/views/overview.js', './src/views/parts.js', './src/views/person.js', './src/views/residents.js', './src/views/settings.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).catch(() => {}));
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  // 只清自己的旧版本：同一个 github.io 域名下的其它网页 app（比如虚拟书架）也用 Cache Storage
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('house-ledger-') && k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  let stored = Promise.resolve();
  const net = fetch(req, { cache: 'no-cache' }).then(res => {
    if (res.ok) {
      const copy = res.clone();
      stored = caches.open(CACHE).then(c => c.put(req, copy));
    }
    return res;
  });
  e.waitUntil(net.then(() => stored, () => {}).catch(() => {}));
  if (req.mode !== 'navigate') {
    e.respondWith(net.catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || Response.error())));
    return;
  }
  const cached = () => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('./index.html'));
  e.respondWith(new Promise(resolve => {
    let settled = false;
    const finish = r => { if (!settled && r) { settled = true; resolve(r); } };
    const timer = setTimeout(() => cached().then(finish), 3000);
    net.then(res => { clearTimeout(timer); finish(res); })
      .catch(() => { clearTimeout(timer); cached().then(r => finish(r || Response.error())); });
  }));
});
