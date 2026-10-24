import { fileUrl } from './api.js';
import { loadPdf, PDF_OPTIONS } from './vendor.js';

const CSS_UNITS = 96 / 72; // pdf.js scale 1 is 72 dpi; "100%" means 96 dpi.

export async function openPdf({ el, book, appearance, onRelocate, onTap, onSwipe }) {
  const pdfjs = await loadPdf();
  const loading = pdfjs.getDocument({ url: fileUrl(book), ...PDF_OPTIONS });
  const doc = await loading.promise;
  const total = doc.numPages;
  let pageNum = Math.min(Math.max(1, book.progress?.page ?? 1), total);
  let zoom = appearance.pdfZoom ?? 'page'; // 'page' | 'width' | number (CSS scale)
  let scale = 1;
  let task = null;
  let seq = 0;

  const wrap = document.createElement('div');
  wrap.className = 'pdf-page';
  el.append(wrap);

  // Outline -> page numbers, resolved in the background for "current chapter".
  const outline = (await doc.getOutline().catch(() => null)) ?? [];
  const toc = [];
  (function walk(items, depth) {
    for (const it of items) {
      toc.push({ label: it.title?.trim() || 'Sem título', target: it.dest, depth, page: null });
      if (it.items?.length) walk(it.items, depth + 1);
    }
  })(outline, 0);

  async function destToPage(dest) {
    const d = typeof dest === 'string' ? await doc.getDestination(dest) : dest;
    if (!Array.isArray(d)) return null;
    const ref = d[0];
    return (typeof ref === 'number' ? ref : await doc.getPageIndex(ref)) + 1;
  }
  const tocReady = Promise.all(toc.map(async (t) => { t.page = await destToPage(t.target).catch(() => null); }));

  const report = () => {
    const chapter = [...toc].reverse().find((t) => t.page && t.page <= pageNum);
    onRelocate({
      percent: total > 1 ? (pageNum - 1) / (total - 1) : 1,
      exact: true,
      label: `Página ${pageNum} de ${total}`,
      chapter: chapter?.target ?? null,
      progress: { page: pageNum, percent: pageNum / total },
      zoomLabel: `${Math.round((scale / CSS_UNITS) * 100)}%`,
    });
  };
  tocReady.then(report);

  async function render() {
    const mine = ++seq;
    const page = await doc.getPage(pageNum);
    if (mine !== seq) return;
    const base = page.getViewport({ scale: 1 });
    const availW = Math.max(200, el.clientWidth - 24);
    const availH = Math.max(200, el.clientHeight - 24);
    scale = zoom === 'width' ? availW / base.width
      : zoom === 'page' ? Math.min(availW / base.width, availH / base.height)
      : zoom;
    const dpr = window.devicePixelRatio || 1;
    const viewport = page.getViewport({ scale: scale * dpr });

    // Render off-screen and swap in, so turning pages never flashes blank.
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    canvas.style.width = `${Math.floor(viewport.width / dpr)}px`;
    canvas.style.height = `${Math.floor(viewport.height / dpr)}px`;
    task?.cancel();
    task = page.render({ canvas, viewport });
    try {
      await task.promise;
    } catch (err) {
      if (err?.name === 'RenderingCancelledException') return;
      throw err;
    }
    if (mine !== seq) return;
    wrap.replaceChildren(canvas);
    report();
    if (pageNum < total) doc.getPage(pageNum + 1).catch(() => {}); // warm up the next page
  }

  const go = (n) => {
    const next = Math.min(Math.max(1, n), total);
    if (next === pageNum) return;
    pageNum = next;
    el.scrollTo(0, 0);
    render();
  };

  el.addEventListener('click', (e) => { if (!window.getSelection()?.toString()) onTap(e); });
  let touchX = null;
  el.addEventListener('touchstart', (e) => { touchX = e.touches.length === 1 ? e.touches[0].screenX : null; }, { passive: true });
  el.addEventListener('touchend', (e) => {
    const x0 = touchX;
    touchX = null;
    if (x0 == null || el.scrollWidth > el.clientWidth + 4) return; // zoomed in: let it pan
    const dx = e.changedTouches[0].screenX - x0;
    if (Math.abs(dx) > 50) onSwipe(dx < 0 ? 1 : -1);
  });

  await render();

  return {
    toc,
    next: () => go(pageNum + 1),
    prev: () => go(pageNum - 1),
    async goTo(target) {
      const p = await destToPage(target);
      if (p) go(p);
    },
    seek: (fraction) => go(Math.round(fraction * (total - 1)) + 1),
    setAppearance(a) {
      if (a.pdfZoom !== zoom) {
        zoom = a.pdfZoom;
        render();
      }
    },
    // Zoom steps from whatever the current fit resolves to.
    zoomBy(factor) {
      zoom = Math.min(6, Math.max(0.25, scale * factor));
      render();
      return zoom;
    },
    resize: () => { if (typeof zoom === 'string') render(); },
    destroy() {
      task?.cancel();
      loading.destroy();
    },
  };
}
