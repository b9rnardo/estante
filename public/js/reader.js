// Reader shell: bars, table of contents, appearance and progress saving.
// The actual rendering lives in epub-engine.js / pdf-engine.js.
import { api } from './api.js';
import { el, esc } from './dom.js';

const PREFS_KEY = 'estante.appearance';
function loadPrefs() {
  const dark = matchMedia('(prefers-color-scheme: dark)').matches;
  const base = { theme: dark ? 'dark' : 'light', fontSize: 100, font: 'original', pdfZoom: 'page' };
  try { return { ...base, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') }; } catch { return base; }
}
function savePrefs(p) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch { /* private mode */ }
}

export function openReader(book, { onClose }) {
  const prefs = loadPrefs();
  const isPdf = book.format === 'pdf';
  const root = el(`
    <div class="reader ${prefs.theme}" data-format="${book.format}" role="dialog" aria-label="${esc(book.title)}">
      <div class="r-top">
        <button class="icon-btn" data-act="close" title="Voltar à estante (Esc)"><svg class="icon"><use href="#i-back"/></svg></button>
        <button class="icon-btn" data-act="toc" title="Sumário" aria-expanded="false"><svg class="icon"><use href="#i-list"/></svg></button>
        <div class="r-title"><b>${esc(book.title)}</b><span class="r-chapter">${esc(book.authors.join(', '))}</span></div>
        <button class="icon-btn" data-act="appearance" title="Aparência" aria-expanded="false"><svg class="icon"><use href="#i-type"/></svg></button>
      </div>
      <div class="r-stage">
        <button class="r-nav" data-act="prev" aria-label="Página anterior"><svg class="icon"><use href="#i-back"/></svg></button>
        <div class="r-view"></div>
        <button class="r-nav" data-act="next" aria-label="Próxima página"><svg class="icon"><use href="#i-next"/></svg></button>
        <div class="r-loading"><span class="spinner"></span></div>
      </div>
      <div class="r-bottom">
        <input type="range" min="0" max="1000" value="0" aria-label="Posição no livro">
        <span class="r-pos"></span>
      </div>
      <div class="r-scrim"></div>
      <aside class="r-toc" aria-label="Sumário">
        <header><h2>Sumário</h2><button class="icon-btn" data-act="toc" aria-label="Fechar sumário"><svg class="icon"><use href="#i-x"/></svg></button></header>
        <ol></ol>
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
  const tocList = $('.r-toc ol');
  const pop = $('.r-pop');
  const scrim = $('.r-scrim');

  let engine = null;
  let closed = false;
  let lastProgress = null;
  let currentChapter = null;
  let saveTimer = null;
  let seeking = false;

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
    book.progress = progress;
    lastProgress = progress;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 800);
  }

  // --- bars auto-hide while reading ---
  let idleTimer;
  const wake = () => {
    root.classList.remove('idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (pop.hidden && !tocEl.classList.contains('open')) root.classList.add('idle');
    }, 2800);
  };
  const toggleBars = () => {
    if (!pop.hidden || tocEl.classList.contains('open')) return closePanels();
    if (root.classList.contains('idle')) wake();
    else { clearTimeout(idleTimer); root.classList.add('idle'); }
  };
  root.addEventListener('mousemove', wake);

  // --- panels ---
  function closePanels() {
    pop.hidden = true;
    tocEl.classList.remove('open');
    scrim.classList.remove('show');
    root.querySelectorAll('[aria-expanded]').forEach((b) => b.setAttribute('aria-expanded', 'false'));
  }
  function toggleToc() {
    const open = !tocEl.classList.contains('open');
    closePanels();
    if (!open) return;
    tocEl.classList.add('open');
    scrim.classList.add('show');
    root.querySelector('[data-act="toc"]').setAttribute('aria-expanded', 'true');
    tocList.querySelector('.current')?.scrollIntoView({ block: 'center' });
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
      tocList.innerHTML = `<li class="empty-toc">Este livro não tem sumário.</li>`;
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
  }

  // --- input ---
  function onKey(e) {
    const k = e.key;
    if (e.metaKey || e.ctrlKey || e.altKey || (k !== 'Escape' && e.target?.matches?.('input, textarea'))) return;
    if (k === 'Escape') {
      if (!pop.hidden || tocEl.classList.contains('open')) closePanels();
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
    const t = e.target.closest('button, a');
    if (!t) return;
    const act = t.dataset.act;
    if (act === 'close') close();
    else if (act === 'toc') toggleToc();
    else if (act === 'appearance') togglePop();
    else if (act === 'next') engine?.next();
    else if (act === 'prev') engine?.prev();
    else if (act === 'bigger') { prefs.fontSize = Math.min(200, prefs.fontSize + 10); applyPrefs(); }
    else if (act === 'smaller') { prefs.fontSize = Math.max(60, prefs.fontSize - 10); applyPrefs(); }
    else if (act === 'zoom-in' || act === 'zoom-out') {
      prefs.pdfZoom = engine?.zoomBy(act === 'zoom-in' ? 1.2 : 1 / 1.2);
      applyPrefs();
    } else if (t.dataset.theme) { prefs.theme = t.dataset.theme; applyPrefs(); }
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
  const onHide = () => { if (document.visibilityState === 'hidden') flush(); };
  document.addEventListener('visibilitychange', onHide);

  function close() {
    if (closed) return;
    closed = true;
    flush();
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('visibilitychange', onHide);
    window.removeEventListener('resize', onResize);
    clearTimeout(idleTimer);
    engine?.destroy();
    root.remove();
    document.body.style.overflow = '';
    onClose?.(book);
  }

  applyPrefs();
  api.update(book.id, { opened: true }).catch(() => {});

  // Engines load in the background; close() works even while they are loading.
  (async () => {
    const opts = { el: view, book, appearance: prefs, onRelocate, onKey, onTap: toggleBars, onSwipe: (d) => (d > 0 ? engine?.next() : engine?.prev()) };
    const e = isPdf
      ? await (await import('./pdf-engine.js')).openPdf(opts)
      : await (await import('./epub-engine.js')).openEpub(opts);
    if (closed) return e.destroy();
    engine = e;
    renderToc();
    $('.r-loading').remove();
    wake();
  })().catch((err) => {
    console.error(err);
    if (closed) return;
    $('.r-loading')?.replaceWith(el(`<div class="r-error"><p>Não consegui abrir este livro.<br><small>${esc(err.message)}</small></p><div><button class="btn" data-act="close">Voltar</button></div></div>`));
  });

  return { close };
}
