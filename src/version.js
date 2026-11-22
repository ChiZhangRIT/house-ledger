// 当前版本号，和 sw.js 的 CACHE 是同一个名字（tests/sw.test.mjs 检查两处一样）。发新版时两处一起改。
// 单独一个文件：「设置 → 隐私与关于」显示它；app.js 拿它判断后台装好的新版是不是比正在跑的这一份新。
export const BUILD = 'house-ledger-v24';

const num = name => { const m = /^house-ledger-v(\d+)$/.exec(name); return m ? Number(m[1]) : null; };
/**
 * Cache Storage 里有没有比正在跑的这一份更新的版本。sw.js 用 skipWaiting + clients.claim、程序文件先走网络：
 * 打开 App 时页面多半已经拿到了新代码，这时浏览器再装好新的 worker、换了控制者，并不代表还有更新的版本，
 * 所以不能一看到 controllerchange 就提示，要比一下版本号。旧版本的缓存在新 worker 启用时才删，可能还在，只看最大的那个。
 */
export function newerBuild(cacheNames, build = BUILD) {
  const mine = num(build);
  if (mine == null) return false;
  return (cacheNames || []).some(name => { const n = num(name); return n != null && n > mine; });
}
