import { api, fileUrl } from './api.js';
import { loadEpub } from './vendor.js';
import { fold, foldMap, findAll, excerpt } from './text.js';

const FONTS = {
  serif: '"Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif',
  sans: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, Roboto, "Helvetica Neue", sans-serif',
};
const INK = {
  light: { fg: '#1f1d1a', link: '#9a4521' },
  sepia: { fg: '#4a3a28', link: '#8f4a22' },
  dark: { fg: '#d6d2c9', link: '#e3906a' },
};
const MAX_HITS = 500;

// Our own <style> inside every chapter iframe, so appearance changes are a
// single textContent swap instead of fighting epub.js theme bookkeeping.
function css({ theme, fontSize, font }) {
  const ink = INK[theme] ?? INK.light;
  const family = FONTS[font];
  return `
    html { font-size: ${fontSize}% !important; background: transparent !important; }
    body { color: ${ink.fg} !important; background: transparent !important; }
    ${family ? `body, body p, body div, body span, body li, body blockquote, body td { font-family: ${family} !important; }` : ''}
    ${theme === 'light' ? '' : `body * { color: inherit !important; background-color: transparent !important; }`}
    a, a * { color: ${ink.link} !important; }
    ${theme === 'dark' ? 'img { opacity: .88; }' : ''}
    ::selection { background: rgba(176, 83, 44, .28); }
  `;
}

function flattenToc(items, depth = 0, out = []) {
  for (const it of items ?? []) {
    out.push({ label: it.label?.trim() || 'Sem título', target: it.href, depth });
    flattenToc(it.subitems, depth + 1, out);
  }
  return out;
}

// WebKit (iPhone, iPad, Safari) doesn't call the page's listeners inside a frame that may not
// run scripts, so taps, swipes and selections in the book would go unnoticed there. On WebKit
// the chapter frames may run scripts, and each chapter comes in with its own scripts, inline
// handlers and frames taken out, plus a policy that blocks anything that slipped through.
const WEBKIT = /AppleWebKit/.test(navigator.userAgent) && !/Chrome\/|Chromium|Android/.test(navigator.userAgent);
const XHTML = 'http://www.w3.org/1999/xhtml';
function disarm(doc) {
  for (const el of doc.querySelectorAll('script, iframe, frame, object, embed')) el.remove();
  for (const el of doc.querySelectorAll('*')) {
    for (const { name, value } of [...el.attributes]) {
      if (/^on/i.test(name) || /^\s*javascript:/i.test(value)) el.removeAttribute(name);
    }
  }
  const policy = doc.createElementNS(XHTML, 'meta');
  policy.setAttribute('http-equiv', 'Content-Security-Policy');
  policy.setAttribute('content', "script-src 'none'; object-src 'none'; frame-src 'none'");
  const head = doc.querySelector('head') ?? doc.documentElement.insertBefore(doc.createElementNS(XHTML, 'head'), doc.documentElement.firstChild);
  head.prepend(policy);
}

// Viewport rectangle around a range inside one of the chapter iframes.
function rectOf(range) {
  if (!range) return null;
  const frame = range.startContainer.ownerDocument.defaultView.frameElement?.getBoundingClientRect() ?? { top: 0, left: 0 };
  let rects = [...range.getClientRects()].filter((r) => r.width && r.height);
  if (!rects.length) rects = [range.getBoundingClientRect()];
  return {
    top: Math.min(...rects.map((r) => r.top)) + frame.top,
    bottom: Math.max(...rects.map((r) => r.bottom)) + frame.top,
    left: Math.min(...rects.map((r) => r.left)) + frame.left,
    right: Math.max(...rects.map((r) => r.right)) + frame.left,
  };
}

export async function openEpub({ el, book, appearance, onRelocate, onKey, onTap, onSwipe, onSelect, onMarkClick }) {
  const ePub = await loadEpub();
  const res = await fetch(fileUrl(book));
  if (!res.ok) throw new Error('Não consegui abrir o arquivo');
  const doc = ePub(await res.arrayBuffer());
  await doc.ready;
  if (WEBKIT) doc.spine.hooks.content.register(disarm);

  const rendition = doc.renderTo(el, {
    width: '100%',
    height: '100%',
    flow: 'paginated',
    spread: 'auto',
    minSpreadWidth: 960,
    allowScriptedContent: WEBKIT,
  });

  let styleText = css(appearance);
  rendition.hooks.content.register((contents) => {
    const s = contents.document.createElement('style');
    s.id = 'estante-style';
    s.textContent = styleText;
    contents.document.head.append(s);
    resolveToc(contents.sectionIndex, contents.document, (node) => contents.cfiFromNode(node));
  });

  // Map each TOC entry to its spine position so we can tell the current chapter.
  // TOC hrefs are relative to the nav file, so fall back to matching file names.
  const spineIndex = (href) => {
    const file = href?.split('#')[0];
    if (!file) return -1;
    const hit = doc.spine.get(file);
    if (hit) return hit.index;
    const base = file.split('/').pop();
    return doc.spine.spineItems.find((s) => s.href.split('/').pop() === base)?.index ?? -1;
  };
  const toc = flattenToc(doc.navigation.toc).map((t) => ({ ...t, spine: spineIndex(t.target) }));

  // Positions are CFIs; highlights are ranges, so compare by where they start.
  const point = (at) => {
    const c = new ePub.CFI(at);
    if (c.range) c.collapse(true);
    return c.toString();
  };
  const compare = (a, b) => new ePub.CFI().compare(point(a), point(b));
  const percentOf = (at) => (doc.locations.length() ? doc.locations.percentageFromCfi(point(at)) : null);

  // Many books (Project Gutenberg's, for one) put several chapters in one file. TOC entries
  // that point inside a file (#id) get a CFI once that file is loaded, so the right one is named.
  function resolveToc(index, document, cfiOf) {
    for (const t of toc) {
      if (t.spine !== index || t.cfi !== undefined) continue;
      const id = t.target?.split('#')[1];
      let node = null;
      try { node = id && document.getElementById(decodeURIComponent(id)); } catch { /* bad escape */ }
      t.cfi = node ? cfiOf(node) : null;
    }
  }
  function chapterAt(index, at) {
    let found;
    for (const t of toc) {
      if (t.spine === -1 || t.spine > index) continue;
      if (t.spine === index && t.cfi && at && compare(t.cfi, at) > 0) continue;
      found = t;
    }
    return found;
  }
  const labelOf = (at) => chapterAt(new ePub.CFI(at).spinePos, at)?.label ?? '';

  let current = null;
  const report = (loc) => {
    if (!loc?.start) return;
    current = loc;
    const ready = doc.locations.length() > 0;
    const percent = ready ? doc.locations.percentageFromCfi(loc.start.cfi) : loc.start.index / Math.max(1, doc.spine.length);
    const chapter = chapterAt(loc.start.index, loc.start.cfi);
    onRelocate({
      percent,
      exact: ready,
      label: chapter?.label ?? '',
      chapter: chapter?.target ?? null,
      progress: { cfi: loc.start.cfi, percent },
    });
  };
  rendition.on('relocated', report);

  // --- selection and highlights ---
  let lastSelection = null;
  const reportSelection = (contents) => {
    const sel = contents.window.getSelection();
    if (!sel?.rangeCount || sel.isCollapsed) return;
    const range = sel.getRangeAt(0);
    const text = range.toString().replace(/\s+/g, ' ').trim();
    if (!text) return;
    const at = contents.cfiFromRange(range);
    if (at === lastSelection) return;
    lastSelection = at;
    onSelect({ at, text, rect: rectOf(range) });
  };
  let dragging = false;
  rendition.on('mousedown', () => { dragging = true; lastSelection = null; onSelect(null); });
  rendition.on('mouseup', (_e, contents) => { dragging = false; setTimeout(() => reportSelection(contents)); });
  // Touch and keyboard selections; a mouse drag that pauses is reported on mouseup instead.
  rendition.on('selected', (_cfi, contents) => { if (!dragging) reportSelection(contents); });

  // A click on a highlight reaches both the page and the highlight; the page's tap
  // (show/hide bars) waits a tick so the highlight can claim it.
  let markClickedAt = 0;
  rendition.on('markClicked', (cfiRange, data) => {
    markClickedAt = Date.now();
    if (data?.id) onMarkClick(data.id, rectOf(rendition.getRange(cfiRange)));
  });

  rendition.on('keydown', onKey);
  rendition.on('click', (e) => {
    if (e.target.closest?.('a') || e.view?.getSelection()?.toString()) return;
    setTimeout(() => { if (Date.now() - markClickedAt > 300) onTap(); });
  });
  let touchX = null;
  rendition.on('touchstart', (e) => { touchX = e.changedTouches[0].screenX; });
  rendition.on('touchend', (e) => {
    if (touchX == null) return;
    const dx = e.changedTouches[0].screenX - touchX;
    touchX = null;
    if (Math.abs(dx) > 50) onSwipe(dx < 0 ? 1 : -1);
  });

  const start = book.progress?.cfi;
  try {
    await rendition.display(start || undefined);
  } catch {
    await rendition.display();
  }

  // Percentages need a "locations" index; build it once and keep it on the server.
  (async () => {
    const cached = await api.locations(book.id).catch(() => null);
    if (cached?.length) doc.locations.load(cached);
    else {
      await doc.locations.generate(1200);
      api.saveLocations(book.id, JSON.parse(doc.locations.save())).catch(() => {});
    }
    if (current) report(current);
  })().catch((err) => console.warn('locations', err));

  // Text on screen, for a bookmark's preview.
  function pageText() {
    try {
      const a = rendition.getRange(current.start.cfi);
      const b = rendition.getRange(current.end.cfi);
      const r = a.startContainer.ownerDocument.createRange();
      r.setStart(a.startContainer, a.startOffset);
      if (b?.endContainer.ownerDocument === r.startContainer.ownerDocument) r.setEnd(b.endContainer, b.endOffset);
      else r.setEndAfter(r.startContainer.ownerDocument.body.lastChild);
      return r.toString().replace(/\s+/g, ' ').trim().slice(0, 220);
    } catch {
      return '';
    }
  }

  const drawn = new Map(); // highlight id -> CFI it was drawn at
  const removeHighlight = (id) => {
    if (!drawn.has(id)) return;
    rendition.annotations.remove(drawn.get(id), 'highlight');
    drawn.delete(id);
  };

  let hit = null; // search result being shown, drawn as an underline so it never collides with a highlight
  const clearHit = () => {
    if (hit) rendition.annotations.remove(hit, 'underline');
    hit = null;
  };

  // Each chapter is loaded on its own, outside the page, and searched as one string
  // so a hit can span <i>, <b> and the like.
  async function search(query, { onHits, signal }) {
    const needle = fold(query.trim());
    let count = 0;
    for (const item of doc.spine.spineItems) {
      if (signal.aborted || count >= MAX_HITS) break;
      await item.load(doc.load.bind(doc));
      try {
        const root = item.document?.body ?? item.document?.querySelector('body') ?? item.document?.documentElement;
        if (!root) continue;
        resolveToc(item.index, item.document, (node) => item.cfiFromElement(node));
        const walker = item.document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        const nodes = [];
        const starts = [];
        let full = '';
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          nodes.push(n);
          starts.push(full.length);
          full += n.nodeValue;
        }
        const locate = (offset, isEnd) => {
          let lo = 0;
          let hi = nodes.length - 1;
          while (lo < hi) {
            const mid = (lo + hi + 1) >> 1;
            if (starts[mid] < offset || (!isEnd && starts[mid] === offset)) lo = mid;
            else hi = mid - 1;
          }
          return [nodes[lo], offset - starts[lo]];
        };
        const found = findAll(foldMap(full), needle, MAX_HITS - count).map(([s, e]) => {
          const range = item.document.createRange();
          range.setStart(...locate(s, false));
          range.setEnd(...locate(e, true));
          const at = item.cfiFromRange(range);
          return { at, label: chapterAt(item.index, at)?.label ?? '', percent: percentOf(at), ...excerpt(full, s, e) };
        });
        count += found.length;
        if (found.length && !signal.aborted) onHits(found);
      } finally {
        item.unload();
      }
      await new Promise((r) => setTimeout(r)); // let the page breathe between chapters
    }
    return { count, truncated: count >= MAX_HITS };
  }

  return {
    toc,
    language: doc.packaging?.metadata?.language || null,
    next: () => rendition.next(),
    prev: () => rendition.prev(),
    goTo: (target) => rendition.display(target),
    seek(fraction) {
      if (doc.locations.length()) return rendition.display(doc.locations.cfiFromPercentage(fraction));
      const item = doc.spine.get(Math.min(doc.spine.length - 1, Math.floor(fraction * doc.spine.length)));
      return item && rendition.display(item.href);
    },
    setAppearance(a) {
      styleText = css(a);
      for (const c of rendition.getContents()) {
        const s = c.document.getElementById('estante-style');
        if (s) s.textContent = styleText;
      }
      // Font changes reflow the columns; jump back to where the reader was.
      const cfi = current?.start?.cfi;
      if (cfi) requestAnimationFrame(() => rendition.display(cfi));
    },
    resize: () => {},

    // --- bookmarks, highlights, search ---
    compare,
    percentOf,
    labelOf,
    location: () => current && {
      at: current.start.cfi,
      label: chapterAt(current.start.index, current.start.cfi)?.label ?? '',
      percent: percentOf(current.start.cfi),
      excerpt: pageText(),
    },
    contains(at) {
      if (!current?.start || typeof at !== 'string') return false;
      const p = point(at);
      return compare(current.start.cfi, p) <= 0 && compare(p, current.end.cfi) <= 0;
    },
    addHighlight(a) {
      removeHighlight(a.id);
      rendition.annotations.highlight(a.at, { id: a.id }, null, `hl-${a.color}`);
      drawn.set(a.id, a.at);
    },
    removeHighlight,
    clearSelection() {
      lastSelection = null;
      for (const c of rendition.getContents()) c.window.getSelection()?.removeAllRanges();
    },
    search,
    async showHit(h) {
      clearHit();
      await rendition.display(h.at);
      rendition.annotations.underline(h.at, {}, null, 'hl-hit');
      hit = h.at;
    },
    clearHit,
    destroy() {
      rendition.destroy();
      doc.destroy();
    },
  };
}
