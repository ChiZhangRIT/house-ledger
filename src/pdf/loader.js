// 用到时才加载 pdf.js（约 1.6MB）；service worker 会把它缓存起来，之后离线也能读 PDF
let loading = null;
export function loadPdfjs() {
  if (!loading) {
    loading = import('../../vendor/pdfjs/pdf.min.mjs').then(m => {
      m.GlobalWorkerOptions.workerSrc = new URL('../../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
      return m;
    }).catch(e => { loading = null; throw e; });
  }
  return loading;
}

/** 文件的 SHA-256（查重用）；不在 https 下时 crypto.subtle 不可用，返回 null */
export async function sha256(buf) {
  try {
    const d = await crypto.subtle.digest('SHA-256', buf);
    return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
  } catch (e) { return null; }
}
