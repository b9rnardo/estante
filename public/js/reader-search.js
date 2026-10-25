// "Buscar no livro": a side panel that lists every hit with its context, ignoring
// case and accents. The engines do the searching (epub-engine.js / pdf-engine.js).
import { esc } from './dom.js';
import { fold } from './text.js';

export function createSearch({ root, isPdf, getEngine, beforeOpen, onToggle }) {
  const panel = root.querySelector('.r-search');
  const button = root.querySelector('[data-act="search"]');
  const input = panel.querySelector('input');
  const status = panel.querySelector('.r-search-status');
  const list = panel.querySelector('.r-results');

  let ctrl = null;
  let query = '';
  let hits = [];
  let current = -1;
  let lastLabel = null;
  let timer = null;

  const narrow = () => root.clientWidth < 760;
  const countText = (n) => (n === 1 ? '1 resultado' : `${n} resultados`);

  function append(found) {
    const html = [];
    for (const h of found) {
      if (h.label && h.label !== lastLabel) html.push(`<li class="r-group">${esc(h.label)}</li>`);
      lastLabel = h.label;
      const pct = h.percent != null && !isPdf ? `<span class="r-item-meta">${Math.round(h.percent * 100)}%</span>` : '';
      html.push(`<li><a href="#" data-hit="${hits.length}"><span class="r-hit">${esc(h.before)}<mark>${esc(h.match)}</mark>${esc(h.after)}</span>${pct}</a></li>`);
      hits.push(h);
    }
    list.insertAdjacentHTML('beforeend', html.join(''));
    status.innerHTML = `<span class="spinner"></span> ${countText(hits.length)}…`;
  }

  async function run() {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q === query) return;
    ctrl?.abort();
    query = q;
    hits = [];
    current = -1;
    lastLabel = null;
    list.replaceChildren();
    getEngine()?.clearHit();
    if (fold(q).length < 2) {
      status.textContent = q ? 'Digite pelo menos duas letras.' : '';
      return;
    }
    const engine = getEngine();
    if (!engine) return;
    ctrl = new AbortController();
    const { signal } = ctrl;
    status.innerHTML = '<span class="spinner"></span> Buscando…';
    try {
      const { count, truncated } = await engine.search(q, { signal, onHits: append });
      if (signal.aborted) return;
      status.textContent = !count ? `Nenhum resultado para “${q}”.` : truncated ? `Mostrando os primeiros ${count} resultados.` : countText(count);
    } catch (err) {
      if (signal.aborted) return;
      console.warn('search', err);
      status.textContent = 'A busca falhou neste livro.';
    }
  }

  function go(i) {
    if (!hits.length) return;
    current = (i + hits.length) % hits.length;
    list.querySelectorAll('a.current').forEach((a) => a.classList.remove('current'));
    const a = list.querySelector(`[data-hit="${current}"]`);
    a?.classList.add('current');
    a?.scrollIntoView({ block: 'nearest' });
    getEngine()?.showHit(hits[current]);
    if (narrow()) hide(); // the panel covers the page on a phone
  }

  function open(text) {
    beforeOpen();
    panel.classList.add('open');
    button.setAttribute('aria-expanded', 'true');
    onToggle();
    if (text != null) {
      input.value = text.replace(/\s+/g, ' ').trim().slice(0, 200);
      run();
    }
    input.focus();
    input.select();
  }
  // Out of the way, results kept (another panel opened, or a hit picked on a phone).
  function hide() {
    panel.classList.remove('open');
    button.setAttribute('aria-expanded', 'false');
    onToggle();
    input.blur();
  }
  function close() {
    hide();
    ctrl?.abort();
    getEngine()?.clearHit();
  }

  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(run, 450);
  });
  panel.querySelector('form').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (q === query && hits.length) go(current + 1);
    else run();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' && hits.length) { e.preventDefault(); go(current + 1); }
    if (e.key === 'ArrowUp' && hits.length) { e.preventDefault(); go(current - 1); }
  });
  list.addEventListener('click', (e) => {
    const a = e.target.closest('[data-hit]');
    if (!a) return;
    e.preventDefault();
    go(Number(a.dataset.hit));
  });
  panel.querySelector('[data-act="search-close"]').addEventListener('click', close);

  return {
    open,
    hide,
    close,
    toggle: () => (panel.classList.contains('open') ? close() : open()),
    isOpen: () => panel.classList.contains('open'),
    destroy: () => ctrl?.abort(),
  };
}
