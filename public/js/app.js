import { api, coverUrl } from './api.js';
import { el, esc } from './dom.js';
import { ensureCover, placeholderColor } from './covers.js';
import { openReader } from './reader.js';

const view = document.getElementById('view');
const qInput = document.getElementById('q');
const LANGS = {
  pt: 'Português', en: 'Inglês', es: 'Espanhol', fr: 'Francês', de: 'Alemão', it: 'Italiano', la: 'Latim', nl: 'Holandês', fi: 'Finlandês', ja: 'Japonês',
  ru: 'Russo', zh: 'Chinês', pl: 'Polonês', uk: 'Ucraniano', ar: 'Árabe', ko: 'Coreano', tr: 'Turco', el: 'Grego', cs: 'Tcheco',
};
const SUGGESTIONS = ['Machado de Assis', 'Eça de Queirós', 'Jane Austen', 'Sherlock Holmes', 'Dostoiévski', 'deep learning'];
const PREVIEW = 4; // results per source in the "Todas" view

let sources = [];
let library = [];
let reader = null;
let searchAbort = null;

// ---------- small helpers ----------
const toastsEl = document.getElementById('toasts');
function toast(message, { action, onAction, error = false, timeout = 4200 } = {}) {
  const t = el(`<div class="toast${error ? ' error' : ''}"><span>${esc(message)}</span>${action ? `<button class="btn">${esc(action)}</button>` : ''}</div>`);
  t.querySelector('button')?.addEventListener('click', () => { t.remove(); onAction?.(); });
  toastsEl.append(t);
  setTimeout(() => t.remove(), timeout);
}

const authorsText = (a) => (a?.length ? a.slice(0, 2).join(', ') + (a.length > 2 ? ' e outros' : '') : 'Autor desconhecido');

function coverHTML({ title, authors, src, format }) {
  const fmt = format ? `<span class="fmt">${format.toUpperCase()}</span>` : '';
  if (src) return `<div class="cover"><img src="${esc(src)}" alt="" loading="lazy" decoding="async">${fmt}</div>`;
  return `<div class="cover placeholder" style="--ph:${placeholderColor(title)}">
    <span class="ph-title">${esc(title)}</span><span class="ph-author">${esc(authorsText(authors))}</span>${fmt}</div>`;
}

// Broken cover URLs (common on Gutenberg/IA) fall back to the drawn placeholder.
document.addEventListener('error', (e) => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement) || !img.closest('.cover')) return;
  const cover = img.closest('.cover');
  const card = cover.closest('[data-title]');
  cover.replaceWith(el(coverHTML({ title: card?.dataset.title ?? '', authors: [card?.dataset.author ?? ''], format: card?.dataset.format })));
}, true);

window.addEventListener('scroll', () => document.querySelector('.top').classList.toggle('scrolled', scrollY > 4), { passive: true });

// ---------- routing ----------
function parseRoute() {
  const [path, query = ''] = location.hash.replace(/^#/, '').split('?');
  return { path: path || '/', params: new URLSearchParams(query) };
}

let shownSearch = null; // "q|fonte" currently on screen, so closing a book doesn't re-run it

async function route({ force = false } = {}) {
  const { path, params } = parseRoute();
  const readMatch = path.match(/^\/ler\/([\w-]+)$/);
  if (readMatch) {
    if (!view.dataset.view) await showLibrary(); // deep link: draw the shelf underneath
    return openBook(readMatch[1]);
  }
  reader?.close();
  if (path === '/busca' && params.get('q')) {
    const key = `${params.get('q')}|${params.get('fonte') ?? 'all'}`;
    if (!force && key === shownSearch && view.dataset.view === 'search') return;
    shownSearch = key;
    return showSearch(params.get('q'), params.get('fonte') ?? 'all');
  }
  shownSearch = null;
  qInput.value = '';
  return showLibrary();
}
window.addEventListener('hashchange', () => route());

const go = (hash) => { if (location.hash !== hash) location.hash = hash; else route(); };
let lastNonReaderHash = '#/';

// ---------- library ----------
function bookCard(b) {
  const pct = b.progress?.percent ?? 0;
  const meta = [authorsText(b.authors)];
  return `
    <article class="book" data-id="${b.id}" data-title="${esc(b.title)}" data-author="${esc(b.authors[0] ?? '')}" data-format="${b.format}" tabindex="0" aria-label="${esc(b.title)}">
      ${coverHTML({ title: b.title, authors: b.authors, src: coverUrl(b), format: b.format })}
      <button class="icon-btn remove" data-remove="${b.id}" title="Remover da estante" aria-label="Remover ${esc(b.title)}"><svg class="icon"><use href="#i-trash"/></svg></button>
      <div class="title">${esc(b.title)}</div>
      <div class="meta">${esc(meta.join(' · '))}</div>
      ${pct > 0 ? `<div class="bar" title="${Math.round(pct * 100)}% lido"><i style="width:${Math.max(2, pct * 100)}%"></i></div>` : ''}
    </article>`;
}

async function showLibrary() {
  view.dataset.view = 'library';
  try {
    library = await api.library();
  } catch (err) {
    view.innerHTML = `<p class="note error">Não consegui carregar a estante: ${esc(err.message)}</p>`;
    return;
  }
  if (!library.length) {
    view.innerHTML = `
      <section class="empty">
        <h2>Sua estante está vazia</h2>
        <p>Busque um título lá em cima ou arraste um EPUB ou PDF para esta janela.</p>
        <div class="suggestions">${SUGGESTIONS.map((s) => `<button class="chip" data-suggest="${esc(s)}">${esc(s)}</button>`).join('')}</div>
      </section>`;
    return;
  }
  const current = library.find((b) => b.lastOpenedAt && (b.progress?.percent ?? 0) < 0.98);
  view.innerHTML = `
    ${current ? `
      <section class="continue" data-id="${current.id}" data-title="${esc(current.title)}" data-author="${esc(current.authors[0] ?? '')}" data-format="${current.format}" tabindex="0">
        ${coverHTML({ title: current.title, authors: current.authors, src: coverUrl(current) })}
        <div class="info">
          <div class="eyebrow">Continuar lendo</div>
          <h3>${esc(current.title)}</h3>
          <div class="muted small">${esc(authorsText(current.authors))}</div>
          <div class="bar"><i style="width:${Math.max(2, (current.progress?.percent ?? 0) * 100)}%"></i></div>
        </div>
      </section>` : ''}
    <div class="section-title"><h2>Estante</h2><span class="count">${library.length} ${library.length === 1 ? 'livro' : 'livros'}</span></div>
    <div class="grid">${library.map(bookCard).join('')}</div>`;

  for (const b of library.filter((x) => !x.cover)) {
    ensureCover(b).then((updated) => updated && refreshCover(updated));
  }
}

function refreshCover(b) {
  const i = library.findIndex((x) => x.id === b.id);
  if (i !== -1) library[i] = b;
  view.querySelectorAll(`[data-id="${b.id}"] > .cover`).forEach((c) => {
    c.replaceWith(el(coverHTML({ title: b.title, authors: b.authors, src: coverUrl(b), format: c.closest('.book') ? b.format : null })));
  });
}

view.addEventListener('click', async (e) => {
  const suggest = e.target.closest('[data-suggest]');
  if (suggest) return go(`#/busca?${new URLSearchParams({ q: suggest.dataset.suggest })}`);

  const rm = e.target.closest('[data-remove]');
  if (rm) {
    e.stopPropagation();
    const b = library.find((x) => x.id === rm.dataset.remove);
    if (!b || !confirm(`Remover “${b.title}” da estante? O arquivo baixado será apagado.`)) return;
    await api.remove(b.id).catch((err) => toast(err.message, { error: true }));
    return showLibrary();
  }
  const card = e.target.closest('.book, .continue');
  if (card) go(`#/ler/${card.dataset.id}`);
});
view.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.matches('.book, .continue')) go(`#/ler/${e.target.dataset.id}`);
});

// ---------- reader ----------
async function openBook(id) {
  if (reader) return;
  let book = library.find((b) => b.id === id);
  if (!book) {
    library = await api.library().catch(() => library);
    book = library.find((b) => b.id === id);
  }
  if (!book) {
    toast('Livro não encontrado na estante', { error: true });
    return go('#/');
  }
  reader = openReader(book, {
    onClose: () => {
      reader = null;
      // Closed from inside the reader: leave the #/ler/ route. (Browser "back"
      // already changed the route, and route() redraws what's underneath.)
      if (parseRoute().path.startsWith('/ler/')) {
        if (history.state?.fromApp) history.back();
        else location.hash = lastNonReaderHash;
      }
    },
  });
}

// Remember where the reader was opened from; mark in-app navigations to readers.
window.addEventListener('hashchange', (e) => {
  const oldHash = new URL(e.oldURL).hash || '#/';
  if (location.hash.startsWith('#/ler/') && !oldHash.startsWith('#/ler/')) {
    lastNonReaderHash = oldHash;
    history.replaceState({ fromApp: true }, '');
  }
});

// ---------- search ----------
// Sources are on until switched off, except opt-in ones, which stay off until switched on.
const OFF_KEY = 'estante.disabledSources';
const ON_KEY = 'estante.enabledSources';
function readSet(key) {
  try { return new Set(JSON.parse(localStorage.getItem(key) ?? '[]')); } catch { return new Set(); }
}
function writeSet(key, set) {
  try { localStorage.setItem(key, JSON.stringify([...set])); } catch { /* ignore */ }
}
const isOn = (s) => (s.optIn ? readSet(ON_KEY).has(s.id) : !readSet(OFF_KEY).has(s.id));
function setOn(s, on) {
  const key = s.optIn ? ON_KEY : OFF_KEY;
  const set = readSet(key);
  if (on === s.optIn) set.add(s.id);
  else set.delete(s.id);
  writeSet(key, set);
}

document.getElementById('search-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const q = qInput.value.trim();
  if (!q) return go('#/');
  const fonte = parseRoute().params.get('fonte') ?? 'all';
  go(`#/busca?${new URLSearchParams({ q, fonte })}`);
  qInput.blur();
});
qInput.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { qInput.value = ''; qInput.blur(); go('#/'); }
});
document.addEventListener('keydown', (e) => {
  if (e.key === '/' && !reader && document.activeElement !== qInput && !e.target.matches('input, textarea')) {
    e.preventDefault();
    qInput.focus();
  }
});

function resultRow(r) {
  const bits = [authorsText(r.authors), r.year, LANGS[r.language] ?? r.language?.toUpperCase()].filter(Boolean);
  return `
    <li class="result" data-title="${esc(r.title)}" data-author="${esc(r.authors[0] ?? '')}">
      ${coverHTML({ title: r.title, authors: r.authors, src: r.cover })}
      <div>
        <h3>${esc(r.title)}</h3>
        <div class="by">${esc(bits.join(' · '))}</div>
        ${r.description ? `<div class="desc">${esc(r.description)}</div>` : ''}
      </div>
      <div class="actions">${actionsHTML(r)}</div>
    </li>`;
}

function actionsHTML(r) {
  if (r.inLibrary) return `<a class="btn primary" href="#/ler/${r.inLibrary}">Ler</a>`;
  return r.formats
    .map((f) => `<button class="btn" data-dl="${f}">${f === 'auto' ? 'Baixar' : f.toUpperCase()}</button>`)
    .join('');
}

// Books built chapter by chapter come back as a job; poll it until the EPUB is ready.
async function followJob(job, onProgress) {
  for (;;) {
    if (job.book) return job.book;
    if (job.error) throw new Error(job.error);
    onProgress(job);
    await new Promise((r) => setTimeout(r, 1000));
    job = await api.job(job.id);
  }
}

async function download(row, r, format, button) {
  const buttons = row.querySelectorAll('[data-dl]');
  buttons.forEach((b) => (b.disabled = true));
  button.innerHTML = '<span class="spinner"></span> Baixando';
  try {
    let book = await api.download(r, format);
    if (book.job) {
      book = await followJob(book.job, ({ done, total }) => {
        button.innerHTML = `<span class="spinner"></span> Baixando${total ? ` ${done}/${total}` : ''}`;
      });
    }
    r.inLibrary = book.id;
    row.querySelector('.actions').innerHTML = actionsHTML(r);
    toast(`“${book.title}” está na estante`, { action: 'Ler', onAction: () => go(`#/ler/${book.id}`) });
    ensureCover(book);
  } catch (err) {
    buttons.forEach((b) => (b.disabled = false));
    button.textContent = format === 'auto' ? 'Baixar' : format.toUpperCase();
    toast(err.message, { error: true, timeout: 6000 });
  }
}

function wireResults(listEl, results) {
  listEl.querySelectorAll('.result').forEach((row, i) => {
    row.addEventListener('click', (e) => {
      const b = e.target.closest('[data-dl]');
      if (b) download(row, results[i], b.dataset.dl, b);
    });
  });
}

function chipsHTML(active, enabled) {
  const chip = (id, label) => `<button class="chip" data-source="${esc(id)}" aria-pressed="${active === id}">${esc(label)}</button>`;
  return `<nav class="chips" aria-label="Fontes">${chip('all', 'Todas')}${enabled.map((s) => chip(s.id, s.name)).join('')}</nav>`;
}

async function showSearch(q, active) {
  view.dataset.view = 'search';
  qInput.value = q;
  searchAbort?.abort();
  searchAbort = new AbortController();
  const signal = searchAbort.signal;
  if (!sources.length) sources = await api.sources();

  const enabled = sources.filter(isOn);
  const target = active === 'all' ? enabled : sources.filter((s) => s.id === active);
  view.innerHTML = chipsHTML(active, enabled.some((s) => s.id === active) || active === 'all' ? enabled : [...enabled, ...target]);
  view.querySelector('.chips').addEventListener('click', (e) => {
    const c = e.target.closest('[data-source]');
    if (c) go(`#/busca?${new URLSearchParams({ q, fonte: c.dataset.source })}`);
  });
  if (!target.length) {
    view.append(el(`<p class="note">Nenhuma fonte ativa. Ative alguma em <b>Fontes</b>, no canto superior direito.</p>`));
    return;
  }

  if (active !== 'all') return singleSource(q, target[0], signal);

  // One section per source, filled in as each one answers.
  for (const src of target) {
    const group = el(`
      <section class="group">
        <div class="group-head"><h2>${esc(src.name)}</h2><span class="status"><span class="spinner"></span></span></div>
        <ul class="results"></ul>
      </section>`);
    view.append(group);
    api.search(src.id, q, 1, signal).then(({ results, hasMore }) => {
      const status = group.querySelector('.status');
      if (!results.length) {
        status.textContent = 'nada encontrado';
        group.querySelector('.results').remove();
        return;
      }
      status.textContent = hasMore ? `${results.length}+ resultados` : `${results.length} ${results.length === 1 ? 'resultado' : 'resultados'}`;
      const shown = results.slice(0, PREVIEW);
      const list = group.querySelector('.results');
      list.innerHTML = shown.map(resultRow).join('');
      wireResults(list, shown);
      if (results.length > PREVIEW || hasMore) {
        const more = el(`<button class="more">Ver todos →</button>`);
        more.addEventListener('click', () => go(`#/busca?${new URLSearchParams({ q, fonte: src.id })}`));
        group.querySelector('.group-head').append(more);
      }
    }).catch((err) => {
      if (signal.aborted) return;
      group.querySelector('.status').innerHTML = `<span class="note error" style="padding:0">${esc(err.message)}</span>`;
      group.querySelector('.results').remove();
    });
  }
}

async function singleSource(q, src, signal) {
  const list = el('<ul class="results"></ul>');
  const footer = el('<div class="load-more"><span class="spinner"></span></div>');
  view.append(list, footer);
  let page = 1;
  const load = async () => {
    footer.innerHTML = '<span class="spinner"></span>';
    try {
      const { results, hasMore } = await api.search(src.id, q, page, signal);
      if (page === 1 && !results.length) {
        footer.innerHTML = `<p class="note">Nada encontrado em ${esc(src.name)} para “${esc(q)}”.</p>`;
        return;
      }
      const frag = el(`<ul>${results.map(resultRow).join('')}</ul>`);
      wireResults(frag, results);
      list.append(...frag.children);
      footer.innerHTML = '';
      if (hasMore) {
        const btn = el('<button class="btn">Carregar mais</button>');
        btn.addEventListener('click', () => { page += 1; load(); });
        footer.append(btn);
      }
    } catch (err) {
      if (signal.aborted) return;
      footer.innerHTML = `<p class="note error">${esc(err.message)}</p>`;
    }
  };
  load();
}

// ---------- import (button + drag and drop) ----------
async function importFiles(files) {
  const ok = [...files].filter((f) => /\.(epub|pdf)$/i.test(f.name));
  if (!ok.length) return toast('Só aceito arquivos .epub e .pdf', { error: true });
  for (const f of ok) {
    try {
      const book = await api.import(f);
      toast(`“${book.title}” adicionado`, { action: 'Ler', onAction: () => go(`#/ler/${book.id}`) });
      ensureCover(book).then((u) => u && refreshCover(u));
    } catch (err) {
      toast(`${f.name}: ${err.message}`, { error: true, timeout: 6000 });
    }
  }
  if (view.dataset.view === 'library') showLibrary();
  else go('#/');
}

document.getElementById('import').addEventListener('change', (e) => {
  importFiles(e.target.files);
  e.target.value = '';
});

const drop = document.getElementById('drop');
let dragDepth = 0;
const hasFiles = (e) => [...(e.dataTransfer?.types ?? [])].includes('Files');
window.addEventListener('dragenter', (e) => { if (hasFiles(e) && !reader) { dragDepth++; drop.hidden = false; } });
window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; drop.hidden = true; } });
window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
window.addEventListener('drop', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  drop.hidden = true;
  if (!reader) importFiles(e.dataTransfer.files);
});

// ---------- settings ----------
const dialog = document.getElementById('settings');
const sourceList = document.getElementById('source-list');

function renderSources() {
  sourceList.innerHTML = sources.map((s) => `
    <li>
      <input type="checkbox" id="src-${esc(s.id)}" data-toggle="${esc(s.id)}" ${isOn(s) ? 'checked' : ''}>
      <label class="grow" for="src-${esc(s.id)}"><div class="name">${esc(s.name)}</div><div class="desc">${esc(s.description)}</div></label>
      ${s.kind === 'opds' ? `<button class="icon-btn" data-del="${esc(s.id.slice(5))}" title="Remover catálogo"><svg class="icon"><use href="#i-trash"/></svg></button>` : ''}
    </li>`).join('');
}

document.getElementById('open-settings').addEventListener('click', async () => {
  sources = await api.sources().catch(() => sources);
  renderSources();
  dialog.showModal();
});
dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); }); // backdrop
dialog.addEventListener('close', () => { if (view.dataset.view === 'search') route({ force: true }); });

sourceList.addEventListener('change', (e) => {
  const s = sources.find((x) => x.id === e.target.dataset.toggle);
  if (s) setOn(s, e.target.checked);
});
sourceList.addEventListener('click', async (e) => {
  const del = e.target.closest('[data-del]');
  if (!del) return;
  await api.removeCatalog(del.dataset.del);
  sources = await api.sources();
  renderSources();
});

document.getElementById('add-catalog').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const btn = form.querySelector('button');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Verificando';
  try {
    const cat = await api.addCatalog({ name: form.name.value.trim(), url: form.url.value.trim() });
    form.reset();
    sources = await api.sources();
    renderSources();
    toast(`Catálogo “${cat.name}” adicionado`);
  } catch (err) {
    toast(err.message, { error: true, timeout: 7000 });
  } finally {
    btn.disabled = false;
    btn.textContent = 'Adicionar';
  }
});

// ---------- start ----------
api.sources().then((s) => { sources = s; }).catch(() => {});
route();
