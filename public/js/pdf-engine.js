import { fileUrl } from './api.js';
import { loadPdf, PDF_OPTIONS } from './vendor.js';
import { fold, foldMap, findAll, excerpt } from './text.js';

const CSS_UNITS = 96 / 72; // pdf.js scale 1 is 72 dpi; "100%" means 96 dpi.
const MAX_HITS = 500;

// Selected text as rectangles in fractions of the page, one per line.
function lineRects(rects, box) {
  const lines = [];
  for (const r of [...rects].sort((a, b) => a.top - b.top || a.left - b.left)) {
    const line = lines.find((l) => Math.abs((l.top + l.bottom) / 2 - (r.top + r.bottom) / 2) < Math.min(l.bottom - l.top, r.height) / 2);
    if (line && r.left <= line.right + r.height) {
      line.left = Math.min(line.left, r.left);
      line.right = Math.max(line.right, r.right);
      line.top = Math.min(line.top, r.top);
      line.bottom = Math.max(line.bottom, r.bottom);
    } else {
      lines.push({ left: r.left, right: r.right, top: r.top, bottom: r.bottom });
    }
  }
  return lines.map((l) => [
    (l.left - box.left) / box.width,
    (l.top - box.top) / box.height,
    (l.right - l.left) / box.width,
    (l.bottom - l.top) / box.height,
  ]);
}

// Client rects of the text nodes inside `range` (element boxes would double them up).
function textRects(range, root) {
  const out = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!range.intersectsNode(n)) continue;
    const r = document.createRange();
    r.setStart(n, n === range.startContainer ? range.startOffset : 0);
    r.setEnd(n, n === range.endContainer ? range.endOffset : n.length);
    out.push(...[...r.getClientRects()].filter((x) => x.width > 0.5 && x.height > 0.5));
  }
  return out;
}

// A PDF's own fonts can be hard to read. With another font (Aa › Fonte, kept per book), the page
// is drawn without its text, and the text layer, already laid over it for selection and search,
// shows that text in the chosen font, each run stretched to the width of the original.
const fontFamily = (font) => (font === 'serif' || font === 'sans'
  ? getComputedStyle(document.documentElement).getPropertyValue(`--${font}`).trim() || null
  : null);

// The page's text content with every font swapped for `family`, which the text layer then
// measures and shows.
const withFont = (content, family) => ({
  ...content,
  styles: Object.fromEntries(Object.entries(content.styles).map(([name, s]) => [name, { ...s, fontFamily: family }])),
});

// pdf.js stretches each run to its width in the PDF by measuring it on a canvas, and WebKit (the
// iOS app) measures the system font there up to 15% narrower than it shows it. Once the runs are
// on screen, measure them there and stretch them again. Rotated runs keep pdf.js's stretch.
function fitRuns(divs, items, scale) {
  const fits = [];
  divs.forEach((div, i) => {
    const stretch = Number(div.style.getPropertyValue('--scale-x'));
    if (!stretch || !div.isConnected || div.style.getPropertyValue('--rotate')) return;
    const { width } = div.getBoundingClientRect();
    const target = items[i].width * scale;
    if (width > 0 && target > 0) fits.push([div, (stretch * target) / width]);
  });
  for (const [div, stretch] of fits) div.style.setProperty('--scale-x', stretch);
}

// pdf.js operator filter that leaves out the page's text. Annotations (form fields) keep
// theirs, since the text layer doesn't have it. `shown()` counts the text runs left out that
// were visible: none means a scan, whose OCR text is invisible and whose image already shows it.
function withoutText(OPS) {
  const TEXT = new Set([OPS.showText, OPS.showSpacedText, OPS.nextLineShowText, OPS.nextLineSetSpacingShowText]);
  const INVISIBLE = new Set([3, 7]); // text rendering modes that paint nothing
  const modes = [];
  let mode = 0;
  let annotation = 0;
  let visible = 0;
  const filter = (i, { fnArray, argsArray }) => {
    const fn = fnArray[i];
    if (fn === OPS.setTextRenderingMode) mode = argsArray[i][0];
    else if (fn === OPS.save) modes.push(mode);
    else if (fn === OPS.restore) mode = modes.pop() ?? 0;
    else if (fn === OPS.beginAnnotation) annotation++;
    else if (fn === OPS.endAnnotation) annotation--;
    else if (TEXT.has(fn) && annotation <= 0) {
      if (!INVISIBLE.has(mode)) visible++;
      return false;
    }
    return true;
  };
  return { filter, shown: () => visible > 0 };
}

export async function openPdf({ el, book, appearance, onRelocate, onTap, onSwipe, onSelect, onMarkClick }) {
  const pdfjs = await loadPdf();
  const loading = pdfjs.getDocument({ url: fileUrl(book), ...PDF_OPTIONS });
  const doc = await loading.promise;
  const total = doc.numPages;
  let pageNum = Math.min(Math.max(1, book.progress?.page ?? 1), total);
  let zoom = appearance.pdfZoom ?? 'page'; // 'page' | 'width' | number (CSS scale)
  let font = book.pdfFont ?? 'original'; // 'original' | 'serif' | 'sans'
  let scale = 1;
  let task = null;
  let seq = 0;
  let layer = null; // the current page's TextLayer
  let rendered = Promise.resolve();

  const wrap = document.createElement('div');
  wrap.className = 'pdf-page';
  el.append(wrap);
  const marks = document.createElement('div');
  marks.className = 'pdf-marks';

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

  // Text of a page as one string (line ends become spaces), with where each pdf.js item starts.
  const texts = new Map();
  function pageText(n) {
    if (!texts.has(n)) {
      texts.set(n, doc.getPage(n).then((p) => p.getTextContent()).then((content) => {
        let full = '';
        const starts = content.items.map((it) => {
          const at = full.length;
          full += it.str + (it.hasEOL ? ' ' : '');
          return at;
        });
        return { content, full, starts };
      }));
      if (texts.size > 60) texts.delete(texts.keys().next().value);
    }
    return texts.get(n);
  }

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

  // --- highlights and the search hit, drawn as boxes over the page ---
  const highlights = new Map(); // id -> { page, rects, color }
  let hit = null; // { page, start, end }

  function box(rect, className, id) {
    const [x, y, w, h] = rect;
    const d = document.createElement('div');
    d.className = className;
    d.style.cssText = `left:${x * 100}%;top:${y * 100}%;width:${w * 100}%;height:${h * 100}%`;
    if (id) d.dataset.id = id;
    return d;
  }

  async function drawMarks() {
    const boxes = [];
    for (const [id, a] of highlights) {
      if (a.page === pageNum) boxes.push(...a.rects.map((r) => box(r, `hl hl-${a.color}`, id)));
    }
    if (hit?.page === pageNum && layer) boxes.push(...hitRects(hit).map((r) => box(r, 'hl hl-hit')));
    marks.replaceChildren(...boxes);
  }

  // Rects of a search hit, from the text layer spans its characters fall in.
  function hitRects({ start, end }) {
    const t = layer?.text;
    if (!t) return [];
    const range = document.createRange();
    const rects = [];
    layer.divs.forEach((div, i) => {
      const node = div.firstChild;
      const from = t.starts[i];
      const to = from + (node?.length ?? 0);
      if (!node || to <= start || from >= end) return;
      range.setStart(node, Math.max(start, from) - from);
      range.setEnd(node, Math.min(end, to) - from);
      rects.push(...range.getClientRects());
    });
    return lineRects(rects, layer.el.getBoundingClientRect());
  }

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
    const cssViewport = page.getViewport({ scale });
    const viewport = page.getViewport({ scale: scale * dpr });

    // Render off-screen and swap in, so turning pages never flashes blank.
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    canvas.style.width = `${Math.floor(viewport.width / dpr)}px`;
    canvas.style.height = `${Math.floor(viewport.height / dpr)}px`;

    // Invisible text over the canvas, so it can be selected, highlighted and found.
    const textEl = document.createElement('div');
    textEl.className = 'textLayer';
    textEl.style.setProperty('--total-scale-factor', scale);
    textEl.style.setProperty('--scale-round-x', '1px');
    textEl.style.setProperty('--scale-round-y', '1px');
    const text = await pageText(pageNum).catch(() => null);
    // Without a text layer to show it, the page keeps its own text.
    const family = text?.content.items.length ? fontFamily(font) : null;
    const textLayer = text && new pdfjs.TextLayer({
      textContentSource: family ? withFont(text.content, family) : text.content,
      container: textEl,
      viewport: cssViewport,
    });
    const strip = family && withoutText(pdfjs.OPS);

    task?.cancel();
    task = page.render({ canvas, viewport, ...(strip && { operationsFilter: strip.filter }) });
    try {
      await Promise.all([task.promise, textLayer?.render()]);
    } catch (err) {
      if (err?.name === 'RenderingCancelledException') return;
      if (!textLayer) throw err;
    }
    if (mine !== seq) return;
    const end = document.createElement('div');
    end.className = 'endOfContent';
    textEl.append(end);
    layer = { el: textEl, divs: textLayer?.textDivs ?? [], text };
    wrap.classList.toggle('own-font', !!strip?.shown());
    wrap.replaceChildren(canvas, marks, textEl);
    // The text layer keeps one run per text item, in order.
    if (strip?.shown()) fitRuns(layer.divs, text.content.items.filter((it) => it.str !== undefined), scale);
    drawMarks();
    report();
    if (pageNum < total) doc.getPage(pageNum + 1).catch(() => {}); // warm up the next page
  }
  const draw = () => (rendered = render());

  const go = (n) => {
    const next = Math.min(Math.max(1, n), total);
    if (next === pageNum) return rendered;
    pageNum = next;
    el.scrollTo(0, 0);
    onSelect(null);
    return draw();
  };

  // --- selection ---
  let lastSelection = '';
  function reportSelection() {
    const sel = window.getSelection();
    if (!sel?.rangeCount || sel.isCollapsed || !layer || !layer.el.contains(sel.anchorNode)) return;
    const range = sel.getRangeAt(0);
    const text = sel.toString().replace(/\s+/g, ' ').trim();
    if (!text) return;
    const pageBox = layer.el.getBoundingClientRect();
    const rects = lineRects(textRects(range, layer.el), pageBox);
    if (!rects.length) return;
    const key = JSON.stringify(rects);
    if (key === lastSelection) return;
    lastSelection = key;
    const r = range.getBoundingClientRect();
    onSelect({ at: { page: pageNum, rects }, text, rect: { top: r.top, bottom: r.bottom, left: r.left, right: r.right } });
  }
  let dragging = false;
  el.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    dragging = true;
    lastSelection = '';
    onSelect(null);
    layer?.el.classList.add('selecting'); // pdf.js trick: keeps the selection from jumping at line ends
  });
  const endDrag = () => {
    if (!dragging) return;
    dragging = false;
    layer?.el.classList.remove('selecting');
    setTimeout(reportSelection);
  };
  window.addEventListener('mouseup', endDrag);
  // Touch and keyboard selections.
  let selTimer = null;
  const onSelectionChange = () => {
    clearTimeout(selTimer);
    if (!dragging) selTimer = setTimeout(reportSelection, 250);
  };
  document.addEventListener('selectionchange', onSelectionChange);

  // Which highlight, if any, sits under a click.
  function markAt(e) {
    if (!layer) return null;
    const b = layer.el.getBoundingClientRect();
    const x = (e.clientX - b.left) / b.width;
    const y = (e.clientY - b.top) / b.height;
    for (const [id, a] of [...highlights].reverse()) {
      if (a.page !== pageNum) continue;
      const r = a.rects.find(([rx, ry, rw, rh]) => x >= rx && x <= rx + rw && y >= ry && y <= ry + rh);
      if (r) {
        const d = marks.querySelector(`[data-id="${CSS.escape(id)}"]`)?.getBoundingClientRect();
        return { id, rect: d && { top: d.top, bottom: d.bottom, left: d.left, right: d.right } };
      }
    }
    return null;
  }

  el.addEventListener('click', (e) => {
    if (window.getSelection()?.toString()) return;
    const m = markAt(e);
    if (m) onMarkClick(m.id, m.rect);
    else onTap(e);
  });
  let touchX = null;
  el.addEventListener('touchstart', (e) => { touchX = e.touches.length === 1 ? e.touches[0].screenX : null; }, { passive: true });
  el.addEventListener('touchend', (e) => {
    const x0 = touchX;
    touchX = null;
    if (x0 == null || el.scrollWidth > el.clientWidth + 4 || window.getSelection()?.toString()) return; // zoomed in: let it pan
    const dx = e.changedTouches[0].screenX - x0;
    if (Math.abs(dx) > 50) onSwipe(dx < 0 ? 1 : -1);
  });

  async function search(query, { onHits, signal }) {
    const needle = fold(query.trim());
    let count = 0;
    for (let n = 1; n <= total && count < MAX_HITS && !signal.aborted; n++) {
      const t = await pageText(n).catch(() => null);
      if (!t || signal.aborted) continue;
      const found = findAll(foldMap(t.full), needle, MAX_HITS - count).map(([s, e]) => ({
        at: { page: n, start: s, end: e },
        label: `Página ${n}`,
        percent: total > 1 ? (n - 1) / (total - 1) : 1,
        ...excerpt(t.full, s, e),
      }));
      count += found.length;
      if (found.length) onHits(found);
      if (n % 20 === 0) await new Promise((r) => setTimeout(r));
    }
    return { count, truncated: count >= MAX_HITS };
  }

  const pageOf = (at) => (typeof at === 'number' ? at : at?.page ?? 0);
  const where = (at) => (typeof at === 'number' ? 0 : at?.rects?.[0]?.[1] ?? at?.start ?? 0);

  await draw();

  return {
    toc,
    language: null,
    next: () => go(pageNum + 1),
    prev: () => go(pageNum - 1),
    async goTo(target) {
      const p = typeof target === 'number' ? target : target?.page ?? (await destToPage(target));
      if (p) await go(p);
    },
    seek: (fraction) => go(Math.round(fraction * (total - 1)) + 1),
    setAppearance(a) {
      if (a.pdfZoom !== zoom) {
        zoom = a.pdfZoom;
        draw();
      }
    },
    setFont(f) {
      if (f === font) return;
      font = f;
      draw();
    },
    // Zoom steps from whatever the current fit resolves to.
    zoomBy(factor) {
      zoom = Math.min(6, Math.max(0.25, scale * factor));
      draw();
      return zoom;
    },
    resize: () => { if (typeof zoom === 'string') draw(); },

    // --- bookmarks, highlights, search ---
    compare: (a, b) => pageOf(a) - pageOf(b) || where(a) - where(b),
    percentOf: (at) => (total > 1 ? (pageOf(at) - 1) / (total - 1) : 1),
    labelOf: (at) => `Página ${pageOf(at)}`,
    async location() {
      const t = await pageText(pageNum).catch(() => null);
      return {
        at: pageNum,
        label: `Página ${pageNum}`,
        percent: total > 1 ? (pageNum - 1) / (total - 1) : 1,
        excerpt: t?.full.replace(/\s+/g, ' ').trim().slice(0, 220) ?? '',
      };
    },
    contains: (at) => pageOf(at) === pageNum,
    addHighlight(a) {
      highlights.set(a.id, { page: a.at.page, rects: a.at.rects, color: a.color });
      if (a.at.page === pageNum) drawMarks();
    },
    removeHighlight(id) {
      if (highlights.delete(id)) drawMarks();
    },
    clearSelection() {
      lastSelection = '';
      window.getSelection()?.removeAllRanges();
    },
    search,
    async showHit(h) {
      hit = h.at;
      await go(h.at.page);
      await rendered;
      drawMarks();
      marks.querySelector('.hl-hit')?.scrollIntoView({ block: 'center', inline: 'nearest' });
    },
    clearHit() {
      hit = null;
      drawMarks();
    },
    destroy() {
      task?.cancel();
      loading.destroy();
      window.removeEventListener('mouseup', endDrag);
      document.removeEventListener('selectionchange', onSelectionChange);
    },
  };
}
