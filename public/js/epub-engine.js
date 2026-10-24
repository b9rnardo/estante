import { api, fileUrl } from './api.js';
import { loadEpub } from './vendor.js';

const FONTS = {
  serif: '"Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif',
  sans: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, Roboto, "Helvetica Neue", sans-serif',
};
const INK = {
  light: { fg: '#1f1d1a', link: '#9a4521' },
  sepia: { fg: '#4a3a28', link: '#8f4a22' },
  dark: { fg: '#d6d2c9', link: '#e3906a' },
};

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

export async function openEpub({ el, book, appearance, onRelocate, onKey, onTap, onSwipe }) {
  const ePub = await loadEpub();
  const res = await fetch(fileUrl(book));
  if (!res.ok) throw new Error('Não consegui abrir o arquivo');
  const doc = ePub(await res.arrayBuffer());
  await doc.ready;

  const rendition = doc.renderTo(el, {
    width: '100%',
    height: '100%',
    flow: 'paginated',
    spread: 'auto',
    minSpreadWidth: 960,
    allowScriptedContent: false,
  });

  let styleText = css(appearance);
  rendition.hooks.content.register((contents) => {
    const s = contents.document.createElement('style');
    s.id = 'estante-style';
    s.textContent = styleText;
    contents.document.head.append(s);
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

  let current = null;
  const report = (loc) => {
    if (!loc?.start) return;
    current = loc;
    const ready = doc.locations.length() > 0;
    const percent = ready ? doc.locations.percentageFromCfi(loc.start.cfi) : loc.start.index / Math.max(1, doc.spine.length);
    const chapter = [...toc].reverse().find((t) => t.spine !== -1 && t.spine <= loc.start.index);
    onRelocate({
      percent,
      exact: ready,
      label: chapter?.label ?? '',
      chapter: chapter?.target ?? null,
      progress: { cfi: loc.start.cfi, percent },
    });
  };
  rendition.on('relocated', report);

  rendition.on('keydown', onKey);
  rendition.on('click', (e) => {
    if (!e.target.closest?.('a') && !e.view?.getSelection()?.toString()) onTap();
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

  return {
    toc,
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
    destroy() {
      rendition.destroy();
      doc.destroy();
    },
  };
}
