// Reader shell: bars, side panel (contents, bookmarks, notes), search, appearance and
// progress saving. The actual rendering lives in epub-engine.js / pdf-engine.js;
// bookmarks and highlights in reader-marks.js, selected text in reader-selection.js.
import { api } from './api.js';
import { el, esc } from './dom.js';
import { createMarks } from './reader-marks.js';
import { createSearch } from './reader-search.js';
import { createSelection } from './reader-selection.js';
import { setTitleBarColors } from './titlebar.js';

const PREFS_KEY = 'estante.appearance';
function loadPrefs() {
  const dark = matchMedia('(prefers-color-scheme: dark)').matches;
  const base = { theme: dark ? 'dark' : 'light', fontSize: 100, font: 'original', pdfZoom: 'page' };
  try { return { ...base, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') }; } catch { return base; }
}
function savePrefs(p) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch { /* private mode */ }
}

// Shortcut hints in tooltips: ⌘ on Apple keyboards, Ctrl everywhere else.
const MOD = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';
const TABS = { toc: 'Sumário', bookmarks: 'Marcadores', notes: 'Notas' };

export function openReader(book, { onClose }) {
  const prefs = loadPrefs();
  const isPdf = book.format === 'pdf';
  const root = el(`
    <div class="reader ${prefs.theme}" data-format="${book.format}" role="dialog" aria-label="${esc(book.title)}">
      <div class="r-top">
        <button class="icon-btn" data-act="close" title="Voltar à estante (Esc)"><svg class="icon"><use href="#i-back"/></svg></button>
        <button class="icon-btn" data-act="toc" title="Sumário, marcadores e notas" aria-expanded="false"><svg class="icon"><use href="#i-list"/></svg></button>
        <div class="r-title"><b>${esc(book.title)}</b><span class="r-chapter">${esc(book.authors.join(', '))}</span></div>
        <button class="icon-btn" data-act="search" title="Buscar no livro (${MOD}F)" aria-expanded="false"><svg class="icon"><use href="#i-search"/></svg></button>
        <button class="icon-btn r-bm-btn" data-act="bookmark" title="Marcar esta página" aria-pressed="false"><svg class="icon"><use href="#i-bookmark"/></svg></button>
        <button class="icon-btn" data-act="appearance" title="Aparência" aria-expanded="false"><svg class="icon"><use href="#i-type"/></svg></button>
      </div>
      <div class="r-stage">
        <button class="r-nav" data-act="prev" aria-label="Página anterior"><svg class="icon"><use href="#i-back"/></svg></button>
        <div class="r-view"></div>
        <button class="r-nav" data-act="next" aria-label="Próxima página"><svg class="icon"><use href="#i-next"/></svg></button>
        <div class="r-loading"><span class="spinner"></span></div>
        <div class="r-ribbon" title="Página marcada" hidden></div>
      </div>
      <div class="r-bottom">
        <input type="range" min="0" max="1000" value="0" aria-label="Posição no livro">
        <span class="r-pos"></span>
      </div>
      <div class="r-scrim"></div>
      <aside class="r-toc" aria-label="Sumário, marcadores e notas">
        <header><h2>Sumário</h2><button class="icon-btn" data-act="toc" aria-label="Fechar painel"><svg class="icon"><use href="#i-x"/></svg></button></header>
        <div class="seg r-tabs" role="tablist">
          ${Object.entries(TABS).map(([k, label]) => `<button role="tab" data-tab-btn="${k}">${label}</button>`).join('')}
        </div>
        <div class="r-panel-body">
          <ol class="r-toc-list" data-tab="toc"></ol>
          <div data-tab="bookmarks" hidden><ul class="r-list"></ul></div>
          <div data-tab="notes" hidden>
            <ul class="r-list"></ul>
            <footer hidden>
              <span class="count"></span>
              <button class="btn" data-act="copy-notes" title="Copiar todas as notas em Markdown"><svg class="icon"><use href="#i-copy"/></svg>Copiar</button>
              <button class="btn" data-act="export-notes" title="Salvar as notas num arquivo Markdown (.md)"><svg class="icon"><use href="#i-export"/></svg>Exportar</button>
            </footer>
          </div>
        </div>
      </aside>
      <aside class="r-search" aria-label="Buscar no livro">
        <header><h2>Buscar no livro</h2><button class="icon-btn" data-act="search-close" aria-label="Fechar busca"><svg class="icon"><use href="#i-x"/></svg></button></header>
        <form class="r-search-form" role="search">
          <svg class="icon" aria-hidden="true"><use href="#i-search"/></svg>
          <input type="search" placeholder="Palavra ou trecho" aria-label="Buscar no livro" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="search">
        </form>
        <div class="r-search-status" aria-live="polite"></div>
        <ol class="r-results"></ol>
      </aside>
      <div class="r-pop" hidden>
        <div>
          <div class="label">Tema</div>
          <div class="row">
            <button class="swatch light" data-theme="light">Claro</button>
            <button class="swatch sepia" data-theme="sepia">Sépia</button>
            <button class="swatch dark" data-theme="dark">Escuro</button>
          </div>
        </div>
        ${isPdf ? `
        <div>
          <div class="label">Zoom</div>
          <div class="row">
            <button class="step" data-act="zoom-out" aria-label="Diminuir zoom"><svg class="icon"><use href="#i-zoom-out"/></svg></button>
            <span class="value" data-zoom-label>—</span>
            <button class="step" data-act="zoom-in" aria-label="Aumentar zoom"><svg class="icon"><use href="#i-zoom-in"/></svg></button>
          </div>
          <div class="seg" style="margin-top:8px">
            <button data-zoom="page">Página inteira</button>
            <button data-zoom="width">Largura</button>
          </div>
        </div>` : `
        <div>
          <div class="label">Tamanho do texto</div>
          <div class="row">
            <button class="step" data-act="smaller" aria-label="Diminuir texto" style="font-size:13px">A</button>
            <span class="value" data-size-label></span>
            <button class="step" data-act="bigger" aria-label="Aumentar texto" style="font-size:19px">A</button>
          </div>
        </div>
        <div>
          <div class="label">Fonte</div>
          <div class="seg">
            <button data-font="original">Original</button>
            <button data-font="serif" style="font-family:var(--serif)">Serifada</button>
            <button data-font="sans">Sem serifa</button>
          </div>
        </div>`}
      </div>
    </div>`);
  document.body.append(root);
  document.body.style.overflow = 'hidden';

  const $ = (s) => root.querySelector(s);
  const view = $('.r-view');
  const range = $('input[type="range"]');
  const pos = $('.r-pos');
  const chapterEl = $('.r-chapter');
  const tocEl = $('.r-toc');
  const tocList = $('.r-toc-list');
  const pop = $('.r-pop');
  const scrim = $('.r-scrim');

  let engine = null;
  let closed = false;
  let lastProgress = null;
  let currentChapter = null;
  let saveTimer = null;
  let seeking = false;
  let tab = 'toc';
  const getEngine = () => engine;

  const marks = createMarks({
    root,
    book,
    isPdf,
    getEngine,
    onGoTo(at) {
      closePanels();
      engine?.goTo(at);
    },
  });
  const search = createSearch({ root, isPdf, getEngine, beforeOpen: () => closePanels(), onToggle: () => paintTitleBar() });
  const selection = createSelection({
    root,
    marks,
    getEngine,
    getLang: () => book.language || engine?.language || 'pt',
    onSearch: (text) => search.open(text),
  });

  const flush = () => {
    clearTimeout(saveTimer);
    if (lastProgress) api.update(book.id, { progress: lastProgress }).catch(() => {});
    lastProgress = null;
  };

  function onRelocate({ percent, exact, label, chapter, progress, zoomLabel }) {
    if (!seeking) range.value = String(Math.round(percent * 1000));
    pos.textContent = isPdf ? label : exact ? `${Math.round(percent * 100)}%` : '';
    chapterEl.textContent = isPdf || !label ? book.authors.join(', ') : label;
    if (zoomLabel) root.querySelector('[data-zoom-label]').textContent = zoomLabel;
    currentChapter = chapter;
    markCurrent();
    marks.sync();
    selection.onRelocate();
    book.progress = progress;
    lastProgress = progress;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 800);
  }

  // --- bars auto-hide while reading ---
  // With a mouse they fade after a few seconds. On a touch screen they stay until the next tap
  // on the page or page turn, so they don't fade under a finger on its way to a button.
  const touch = matchMedia('(hover: none)');
  let idleTimer;
  const busy = () => !pop.hidden || tocEl.classList.contains('open') || search.isOpen() || selection.isOpen();
  const wake = () => {
    root.classList.remove('idle');
    clearTimeout(idleTimer);
    if (!touch.matches) idleTimer = setTimeout(() => { if (!busy()) root.classList.add('idle'); }, 2800);
  };
  function onTap() {
    if (selection.isOpen()) return selection.dismiss();
    if (!pop.hidden || tocEl.classList.contains('open')) return closePanels();
    if (root.classList.contains('idle')) wake();
    else { clearTimeout(idleTimer); root.classList.add('idle'); }
  }
  // Only a real mouse: a tap also sends a mousemove, which would wake the bars just before
  // the tap itself hides them again.
  root.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') wake(); });

  // --- panels ---
  function closePanels() {
    pop.hidden = true;
    tocEl.classList.remove('open');
    scrim.classList.remove('show');
    search.hide();
    root.querySelectorAll('[aria-expanded]').forEach((b) => b.setAttribute('aria-expanded', 'false'));
  }
  function showTab(name) {
    tab = name;
    $('.r-toc h2').textContent = TABS[name];
    root.querySelectorAll('[data-tab-btn]').forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.tabBtn === name));
      b.setAttribute('aria-selected', String(b.dataset.tabBtn === name));
    });
    root.querySelectorAll('[data-tab]').forEach((p) => { p.hidden = p.dataset.tab !== name; });
    if (name === 'toc') tocList.querySelector('.current')?.scrollIntoView({ block: 'center' });
  }
  function toggleToc() {
    const open = !tocEl.classList.contains('open');
    closePanels();
    if (!open) return;
    tocEl.classList.add('open');
    scrim.classList.add('show');
    root.querySelector('[data-act="toc"]').setAttribute('aria-expanded', 'true');
    showTab(tab);
  }
  function togglePop() {
    const open = pop.hidden;
    closePanels();
    if (!open) return;
    pop.hidden = false;
    root.querySelector('[data-act="appearance"]').setAttribute('aria-expanded', 'true');
  }
  function markCurrent() {
    tocList.querySelectorAll('a').forEach((a, i) => a.classList.toggle('current', engine?.toc[i]?.target === currentChapter));
  }

  function renderToc() {
    if (!engine.toc.length) {
      tocList.innerHTML = `<li class="r-empty">Este livro não tem sumário.</li>`;
      return;
    }
    tocList.innerHTML = engine.toc
      .map((t, i) => `<li><a href="#" data-i="${i}" style="padding-left:${12 + t.depth * 14}px">${esc(t.label)}</a></li>`)
      .join('');
    markCurrent();
  }

  function applyPrefs() {
    root.classList.remove('light', 'sepia', 'dark');
    root.classList.add(prefs.theme);
    root.querySelectorAll('[data-theme]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.theme === prefs.theme)));
    root.querySelectorAll('[data-font]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.font === prefs.font)));
    root.querySelectorAll('[data-zoom]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.zoom === prefs.pdfZoom)));
    const size = root.querySelector('[data-size-label]');
    if (size) size.textContent = `${prefs.fontSize}%`;
    savePrefs(prefs);
    engine?.setAppearance(prefs);
    paintTitleBar();
  }

  // Windows caption buttons (titlebar.js): the reader's colours, or the search panel's
  // while it is open, since it reaches the top-right corner.
  function paintTitleBar() {
    setTitleBarColors(root, search.isOpen() ? '--r-panel' : '--r-bg', '--r-fg');
  }

  // --- input ---
  function onKey(e) {
    const k = e.key;
    const mod = (e.metaKey || e.ctrlKey) && !e.altKey;
    if (mod && (k === 'f' || k === 'F')) { e.preventDefault?.(); search.open(); return; }
    if (mod && (k === 'd' || k === 'D')) { e.preventDefault?.(); marks.toggleBookmark(); return; }
    if (e.metaKey || e.ctrlKey || e.altKey || (k !== 'Escape' && e.target?.matches?.('input, textarea'))) return;
    if (k === 'Escape') {
      if (selection.isOpen()) selection.cancel();
      else if (!pop.hidden || tocEl.classList.contains('open')) closePanels();
      else if (search.isOpen()) search.close();
      else close();
    } else if (k === 'ArrowRight' || k === 'PageDown' || (k === ' ' && !e.shiftKey)) {
      e.preventDefault?.(); engine?.next();
    } else if (k === 'ArrowLeft' || k === 'PageUp' || (k === ' ' && e.shiftKey)) {
      e.preventDefault?.(); engine?.prev();
    } else if (!isPdf && k === 'ArrowDown') {
      engine?.next();
    } else if (!isPdf && k === 'ArrowUp') {
      engine?.prev();
    }
  }
  document.addEventListener('keydown', onKey);

  root.addEventListener('click', (e) => {
    if (e.target === root) return onTap(); // a hidden bar on a touch screen (see reader.css)
    const t = e.target.closest('button, a');
    if (!t) return;
    const act = t.dataset.act;
    if (act === 'close') close();
    else if (act === 'toc') toggleToc();
    else if (act === 'search') search.toggle();
    else if (act === 'bookmark') marks.toggleBookmark();
    else if (act === 'appearance') togglePop();
    else if (act === 'next') engine?.next();
    else if (act === 'prev') engine?.prev();
    else if (act === 'bigger') { prefs.fontSize = Math.min(200, prefs.fontSize + 10); applyPrefs(); }
    else if (act === 'smaller') { prefs.fontSize = Math.max(60, prefs.fontSize - 10); applyPrefs(); }
    else if (act === 'zoom-in' || act === 'zoom-out') {
      prefs.pdfZoom = engine?.zoomBy(act === 'zoom-in' ? 1.2 : 1 / 1.2);
      applyPrefs();
    } else if (t.dataset.tabBtn) showTab(t.dataset.tabBtn);
    else if (t.dataset.theme) { prefs.theme = t.dataset.theme; applyPrefs(); }
    else if (t.dataset.font) { prefs.font = t.dataset.font; applyPrefs(); }
    else if (t.dataset.zoom) { prefs.pdfZoom = t.dataset.zoom; applyPrefs(); }
    else if (t.dataset.i != null) {
      e.preventDefault();
      engine?.goTo(engine.toc[Number(t.dataset.i)].target);
      closePanels();
    }
  });
  scrim.addEventListener('click', closePanels);

  range.addEventListener('input', () => { seeking = true; });
  range.addEventListener('change', async () => {
    await engine?.seek(Number(range.value) / 1000);
    seeking = false;
  });

  let resizeTimer;
  const onResize = () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => engine?.resize(), 150); };
  window.addEventListener('resize', onResize);
  const onHide = () => {
    if (document.visibilityState !== 'hidden') return;
    flush();
    marks.flush();
  };
  document.addEventListener('visibilitychange', onHide);

  function close() {
    if (closed) return;
    closed = true;
    flush();
    marks.flush();
    search.destroy();
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('visibilitychange', onHide);
    window.removeEventListener('resize', onResize);
    clearTimeout(idleTimer);
    engine?.destroy();
    root.remove();
    setTitleBarColors(null);
    document.body.style.overflow = '';
    onClose?.(book);
  }

  applyPrefs();
  showTab('toc');
  api.update(book.id, { opened: true }).catch(() => {});

  // Engines load in the background; close() works even while they are loading.
  (async () => {
    const opts = {
      el: view,
      book,
      appearance: prefs,
      onRelocate,
      onKey,
      onTap,
      onSwipe: (d) => {
        if (touch.matches && !busy()) root.classList.add('idle');
        return d > 0 ? engine?.next() : engine?.prev();
      },
      onSelect: (s) => selection.onSelect(s),
      onMarkClick: (id, rect) => selection.onMarkClick(id, rect),
    };
    const e = isPdf
      ? await (await import('./pdf-engine.js')).openPdf(opts)
      : await (await import('./epub-engine.js')).openEpub(opts);
    if (closed) return e.destroy();
    engine = e;
    renderToc();
    marks.attach();
    $('.r-loading').remove();
    wake();
  })().catch((err) => {
    console.error(err);
    if (closed) return;
    $('.r-loading')?.replaceWith(el(`<div class="r-error"><p>Não consegui abrir este livro.<br><small>${esc(err.message)}</small></p><div><button class="btn" data-act="close">Voltar</button></div></div>`));
  });

  return { close };
}
