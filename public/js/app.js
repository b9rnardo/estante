import { api, coverUrl, native } from './api.js';
import { el, esc, toast } from './dom.js';
import { ensureCover, placeholderColor } from './covers.js';
import { openReader } from './reader.js';
import { openMenu, justClosed } from './menu.js';
import { openSheet, askText } from './sheet.js';
import { fold } from './text.js';

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
let collections = [];
let reader = null;
let searchAbort = null;

// ---------- small helpers ----------
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
const pctOf = (b) => b.progress?.percent ?? 0;
const isRead = (b) => !!b.finishedAt;
const isStarted = (b) => !!b.lastOpenedAt || pctOf(b) > 0;
const MORE_ICON = '<svg class="icon"><use href="#i-more"/></svg>';

const STATUS = [
  { id: 'all', label: 'Todos', test: () => true },
  { id: 'reading', label: 'Lendo', test: (b) => !isRead(b) && isStarted(b), empty: 'Nenhum livro em andamento.' },
  { id: 'unread', label: 'Não começados', test: (b) => !isRead(b) && !isStarted(b), empty: 'Você já começou todos os livros da estante.' },
  { id: 'read', label: 'Lidos', test: isRead, empty: `Nenhum livro marcado como lido. Use o menu ${MORE_ICON} de um livro para marcá-lo.` },
];

const collator = new Intl.Collator('pt-BR', { sensitivity: 'base', numeric: true, ignorePunctuation: true });
const recent = (a, b) => (b.lastOpenedAt ?? b.addedAt ?? '').localeCompare(a.lastOpenedAt ?? a.addedAt ?? '');
const SORTS = [
  { id: 'recent', label: 'Recentes', menu: 'Abertos recentemente', cmp: recent },
  { id: 'added', label: 'Adicionados', menu: 'Adicionados recentemente', cmp: (a, b) => (b.addedAt ?? '').localeCompare(a.addedAt ?? '') },
  { id: 'title', label: 'Título', menu: 'Título (A–Z)', cmp: (a, b) => collator.compare(a.title, b.title) },
  {
    id: 'author', label: 'Autor', menu: 'Autor (A–Z)',
    cmp: (a, b) => !a.authors[0] - !b.authors[0] || collator.compare(a.authors[0] ?? '', b.authors[0] ?? '') || collator.compare(a.title, b.title),
  },
  { id: 'progress', label: 'Progresso', menu: 'Progresso', cmp: (a, b) => (isRead(b) ? 1 : pctOf(b)) - (isRead(a) ? 1 : pctOf(a)) || recent(a, b) },
];

// How the shelf is sorted and filtered, remembered between visits (the text filter only for this one).
const SHELF_KEY = 'estante.shelf';
const shelf = { sort: 'recent', filter: 'all', q: '' };
try { Object.assign(shelf, JSON.parse(localStorage.getItem(SHELF_KEY) ?? '{}'), { q: '' }); } catch { /* ignore */ }
const saveShelf = () => {
  try { localStorage.setItem(SHELF_KEY, JSON.stringify({ sort: shelf.sort, filter: shelf.filter })); } catch { /* ignore */ }
};

const inCollection = (c) => library.filter((b) => b.collections?.includes(c.id)).length;
const sortedCollections = () => [...collections].sort((a, b) => collator.compare(a.name, b.name));
const booksText = (n) => `${n} ${n === 1 ? 'livro' : 'livros'}`;

function bookCard(b) {
  const pct = pctOf(b);
  const meta = [authorsText(b.authors)];
  return `
    <article class="book" data-id="${b.id}" data-title="${esc(b.title)}" data-author="${esc(b.authors[0] ?? '')}" data-format="${b.format}" tabindex="0" aria-label="${esc(b.title)}">
      ${coverHTML({ title: b.title, authors: b.authors, src: coverUrl(b), format: b.format })}
      <button class="icon-btn book-menu" data-book-menu="${b.id}" title="Opções" aria-label="Opções de ${esc(b.title)}" aria-haspopup="menu">${MORE_ICON}</button>
      <div class="title">${esc(b.title)}</div>
      <div class="meta">${esc(meta.join(' · '))}</div>
      ${isRead(b) ? '<div class="done"><svg class="icon"><use href="#i-check"/></svg>Lido</div>'
        : pct > 0 ? `<div class="bar" title="${Math.round(pct * 100)}% lido"><i style="width:${Math.max(2, pct * 100)}%"></i></div>` : ''}
    </article>`;
}

function continueHTML(b) {
  return `
    <section class="continue" data-id="${b.id}" data-title="${esc(b.title)}" data-author="${esc(b.authors[0] ?? '')}" data-format="${b.format}" tabindex="0">
      ${coverHTML({ title: b.title, authors: b.authors, src: coverUrl(b) })}
      <div class="info">
        <div class="eyebrow">Continuar lendo</div>
        <h3>${esc(b.title)}</h3>
        <div class="muted small">${esc(authorsText(b.authors))}</div>
        <div class="bar"><i style="width:${Math.max(2, pctOf(b) * 100)}%"></i></div>
      </div>
    </section>`;
}

async function showLibrary() {
  view.dataset.view = 'library';
  try {
    [library, collections] = await Promise.all([api.library(), api.collections()]);
  } catch (err) {
    view.innerHTML = `<p class="note error">Não consegui carregar a estante: ${esc(err.message)}</p>`;
    return;
  }
  if (!library.length) {
    // A phone or tablet can't drop a file on the page; it imports with the + button.
    const add = matchMedia('(hover: none)').matches ? 'toque em + para importar um EPUB ou PDF' : 'arraste um EPUB ou PDF para esta janela';
    view.innerHTML = `${updateHTML()}
      <section class="empty">
        <h2>Sua estante está vazia</h2>
        <p>Busque um título lá em cima ou ${add}.</p>
        <div class="suggestions">${SUGGESTIONS.map((s) => `<button class="chip" data-suggest="${esc(s)}">${esc(s)}</button>`).join('')}</div>
      </section>`;
    return;
  }
  // The server lists the most recently opened first.
  const current = library.find((b) => b.lastOpenedAt && !isRead(b) && pctOf(b) < 0.98);
  view.innerHTML = `${updateHTML()}
    ${current ? continueHTML(current) : ''}
    <nav class="chips shelf-chips" aria-label="Organizar a estante"></nav>
    <div class="section-title shelf-title">
      <h2></h2><span class="count"></span>
      <button class="icon-btn" data-collection-menu aria-haspopup="menu" title="Renomear ou apagar a coleção" hidden>${MORE_ICON}</button>
      <div class="shelf-tools">
        <label class="shelf-filter">
          <svg class="icon" aria-hidden="true"><use href="#i-search"/></svg>
          <input type="search" placeholder="Filtrar por título ou autor" aria-label="Filtrar a estante por título ou autor" autocomplete="off" autocapitalize="off" spellcheck="false">
        </label>
        <button class="btn shelf-sort" data-sort-menu aria-haspopup="menu" title="Ordenar"><svg class="icon"><use href="#i-sort"/></svg><span></span></button>
      </div>
    </div>
    <div class="grid"></div>`;
  const input = view.querySelector('.shelf-filter input');
  input.value = shelf.q;
  input.addEventListener('input', () => { shelf.q = input.value; renderShelf(); });
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    if (input.value) { input.value = shelf.q = ''; renderShelf(); } else input.blur();
  });
  renderShelf();

  for (const b of library.filter((x) => !x.cover)) {
    ensureCover(b).then((updated) => updated && refreshCover(updated));
  }
}

// Redraws what the filter and the order change (chips, heading, grid), leaving the text field alone.
function renderShelf() {
  const grid = view.querySelector('.shelf-title + .grid');
  if (view.dataset.view !== 'library' || !grid) return;
  const status = STATUS.find((s) => s.id === shelf.filter);
  const coll = collections.find((c) => c.id === shelf.filter);
  if (!status && !coll) {
    shelf.filter = 'all';
    return renderShelf();
  }
  const sort = SORTS.find((s) => s.id === shelf.sort) ?? SORTS[0];
  const q = fold(shelf.q.trim());
  const books = library
    .filter((b) => (coll ? b.collections?.includes(coll.id) : status.test(b)))
    .filter((b) => !q || fold(`${b.title} ${b.authors.join(' ')}`).includes(q))
    .sort(sort.cmp);

  const chip = (id, label, n) => `<button class="chip" data-filter="${esc(id)}" aria-pressed="${shelf.filter === id}">${esc(label)}<span class="n">${n}</span></button>`;
  view.querySelector('.shelf-chips').innerHTML = [
    ...STATUS.map((s) => chip(s.id, s.label, library.filter(s.test).length)),
    '<span class="chip-sep" aria-hidden="true"></span>',
    ...sortedCollections().map((c) => chip(c.id, c.name, inCollection(c))),
    '<button class="chip chip-add" data-new-collection><svg class="icon"><use href="#i-plus"/></svg>Nova coleção</button>',
  ].join('');
  view.querySelector('.shelf-title h2').textContent = coll?.name ?? (status.id === 'all' ? 'Estante' : status.label);
  view.querySelector('.shelf-title .count').textContent = booksText(books.length);
  view.querySelector('[data-collection-menu]').hidden = !coll;
  view.querySelector('.shelf-sort span').textContent = sort.label;

  let empty = status?.empty;
  if (q) empty = `Nenhum livro corresponde a “${esc(shelf.q.trim())}”.`;
  else if (coll) empty = `Esta coleção está vazia. Para pôr um livro nela, abra o menu ${MORE_ICON} do livro e escolha <b>Coleções…</b>`;
  // Keep keyboard focus on the same book (or its menu button) across the redraw.
  const focused = grid.contains(document.activeElement) ? document.activeElement : null;
  const focusId = focused?.closest('.book')?.dataset.id;
  grid.innerHTML = books.length ? books.map(bookCard).join('') : `<p class="note shelf-empty">${empty}</p>`;
  const card = focusId && grid.querySelector(`.book[data-id="${focusId}"]`);
  if (card) (focused.matches('.book-menu') ? card.querySelector('.book-menu') : card).focus({ preventScroll: true });
}

// Desktop app: a newer release on GitHub (electron/main.js), until dismissed for that version.
const UPDATE_KEY = 'estante.dismissedUpdate';
let update = null; // { version, url }

function updateHTML() {
  let dismissed = null;
  try { dismissed = localStorage.getItem(UPDATE_KEY); } catch { /* ignore */ }
  if (!update || update.version === dismissed) return '';
  // The link opens in the default browser, like every link that leaves the app (electron/main.js).
  return `
    <aside class="update" aria-label="Nova versão">
      <svg class="icon" aria-hidden="true"><use href="#i-export"/></svg>
      <span>Estante ${esc(update.version)} disponível</span>
      <a class="btn primary" href="${esc(update.url)}" target="_blank" rel="noopener">Baixar</a>
      <button class="icon-btn" data-dismiss-update title="Dispensar" aria-label="Dispensar aviso"><svg class="icon"><use href="#i-x"/></svg></button>
    </aside>`;
}

window.estante?.onUpdate?.((u) => {
  update = u;
  if (view.dataset.view !== 'library') return;
  view.querySelector('.update')?.remove();
  const notice = updateHTML();
  if (notice) view.prepend(el(notice));
});

function refreshCover(b) {
  const i = library.findIndex((x) => x.id === b.id);
  if (i !== -1) library[i] = b;
  view.querySelectorAll(`[data-id="${b.id}"] > .cover`).forEach((c) => {
    c.replaceWith(el(coverHTML({ title: b.title, authors: b.authors, src: coverUrl(b), format: c.closest('.book') ? b.format : null })));
  });
}

// ---------- organizing: book menu, collections, details ----------
function keepBook(updated) {
  const i = library.findIndex((x) => x.id === updated.id);
  if (i !== -1) library[i] = updated;
  return updated;
}

async function patchBook(b, patch) {
  try {
    const updated = keepBook(await api.update(b.id, patch));
    renderShelf();
    return updated;
  } catch (err) {
    toast(err.message, { error: true });
    return null;
  }
}

async function setFinished(b, finished) {
  const u = await patchBook(b, { finished });
  if (!u) return;
  toast(finished ? `“${u.title}” está nos lidos` : `“${u.title}” voltou para a fila`, {
    action: 'Desfazer',
    onAction: () => patchBook(u, { finished: !finished }),
  });
}

async function removeBook(b) {
  if (!confirm(`Remover “${b.title}” da estante? O arquivo baixado será apagado.`)) return;
  await api.remove(b.id).catch((err) => toast(err.message, { error: true }));
  showLibrary();
}

function bookMenu(b, anchor) {
  const coll = collections.find((c) => c.id === shelf.filter && b.collections?.includes(c.id));
  openMenu(anchor, [
    { label: isRead(b) ? 'Marcar como não lido' : 'Marcar como lido', icon: 'i-check', onSelect: () => setFinished(b, !isRead(b)) },
    { label: 'Coleções…', icon: 'i-folder', onSelect: () => collectionsSheet(b) },
    ...(coll ? [{ label: `Tirar de “${coll.name}”`, icon: 'i-x', onSelect: () => patchBook(b, { collections: b.collections.filter((c) => c !== coll.id) }) }] : []),
    { label: 'Editar informações…', icon: 'i-pencil', onSelect: () => editSheet(b) },
    '-',
    { label: 'Remover da estante', icon: 'i-trash', danger: true, onSelect: () => removeBook(b) },
  ], { label: b.title });
}

function sortMenu(anchor) {
  openMenu(anchor, SORTS.map((s) => ({
    label: s.menu,
    checked: s.id === shelf.sort,
    onSelect: () => { shelf.sort = s.id; saveShelf(); renderShelf(); },
  })), { label: 'Ordenar por' });
}

async function createCollection(name) {
  try {
    const c = await api.addCollection(name);
    if (!collections.some((x) => x.id === c.id)) collections.push(c);
    return c;
  } catch (err) {
    toast(err.message, { error: true });
    return null;
  }
}

async function newCollection() {
  const name = await askText({ title: 'Nova coleção', label: 'Nome', placeholder: 'Ex.: Clássicos, Para estudar, Favoritos', ok: 'Criar' });
  const c = name && (await createCollection(name));
  if (!c) return;
  shelf.filter = c.id;
  saveShelf();
  renderShelf();
}

function collectionMenu(c, anchor) {
  openMenu(anchor, [
    { label: 'Renomear…', icon: 'i-pencil', onSelect: () => renameCollection(c) },
    { label: 'Apagar coleção', icon: 'i-trash', danger: true, onSelect: () => deleteCollection(c) },
  ], { label: c.name });
}

async function renameCollection(c) {
  const name = await askText({ title: 'Renomear coleção', label: 'Nome', value: c.name });
  if (!name || name === c.name) return;
  try {
    Object.assign(c, await api.renameCollection(c.id, name));
    renderShelf();
  } catch (err) {
    toast(err.message, { error: true });
  }
}

async function deleteCollection(c) {
  const n = inCollection(c);
  if (!confirm(`Apagar a coleção “${c.name}”?${n ? ` ${n === 1 ? 'O livro continua' : `Os ${n} livros continuam`} na estante.` : ''}`)) return;
  try {
    await api.removeCollection(c.id);
  } catch (err) {
    return toast(err.message, { error: true });
  }
  collections = collections.filter((x) => x !== c);
  for (const b of library) if (b.collections?.includes(c.id)) b.collections = b.collections.filter((x) => x !== c.id);
  shelf.filter = 'all';
  saveShelf();
  renderShelf();
  toast(`Coleção “${c.name}” apagada`);
}

// Which collections a book is in: ticks apply right away; new ones can be made here too.
function collectionsSheet(b) {
  const d = openSheet('Coleções', `
    <p class="muted small sheet-sub">${esc(b.title)}</p>
    <ul class="source-list coll-list"></ul>
    <form class="inline-add">
      <input placeholder="Nova coleção" maxlength="60" autocomplete="off" aria-label="Nome da nova coleção">
      <button class="btn">Criar</button>
    </form>
    <div class="sheet-actions"><button type="button" class="btn primary" data-close>Concluído</button></div>`);
  const list = d.querySelector('.coll-list');
  let ids = [...(b.collections ?? [])];
  const draw = () => {
    list.innerHTML = collections.length
      ? sortedCollections().map((c) => `
        <li>
          <input type="checkbox" id="coll-${esc(c.id)}" data-coll="${esc(c.id)}" ${ids.includes(c.id) ? 'checked' : ''}>
          <label class="grow" for="coll-${esc(c.id)}"><div class="name">${esc(c.name)}</div><div class="desc">${booksText(inCollection(c))}</div></label>
        </li>`).join('')
      : '<li class="muted small">Nenhuma coleção ainda. Crie a primeira aqui embaixo.</li>';
  };
  // Saves run one after another, each with every box ticked at that moment.
  let chain = Promise.resolve();
  const save = () => {
    ids = [...list.querySelectorAll('[data-coll]:checked')].map((i) => i.dataset.coll);
    const next = ids;
    chain = chain.then(() => patchBook(b, { collections: next })).then((u) => { if (u) b = u; });
    return chain;
  };
  draw();
  list.addEventListener('change', async (e) => {
    if (!e.target.dataset.coll) return;
    await save();
    draw();
  });
  d.querySelector('.inline-add').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = e.target.querySelector('input');
    const name = input.value.trim();
    if (!name) return input.focus();
    const c = await createCollection(name);
    if (!c) return;
    input.value = '';
    if (!ids.includes(c.id)) ids.push(c.id);
    draw();
    await save();
    draw();
  });
}

function editSheet(b) {
  let file = null;
  let preview = null;
  const d = openSheet('Editar informações', `
    <form class="form">
      <div class="edit-cover">
        ${coverHTML({ title: b.title, authors: b.authors, src: coverUrl(b) })}
        <div>
          <button type="button" class="btn" data-pick-cover><svg class="icon"><use href="#i-image"/></svg>Trocar capa…</button>
          <p class="muted small">JPG, PNG ou WebP, até 5 MB.</p>
          <input type="file" accept="image/jpeg,image/png,image/webp" hidden>
        </div>
      </div>
      <label><span>Título</span><input name="title" value="${esc(b.title)}" maxlength="300" required autocomplete="off"></label>
      <label><span>Autores</span><input name="authors" value="${esc(b.authors.join(', '))}" placeholder="Separe os nomes com vírgulas" autocomplete="off"></label>
      <div class="sheet-actions">
        <button type="button" class="btn" data-close>Cancelar</button>
        <button class="btn primary">Salvar</button>
      </div>
    </form>`, { onClose: () => preview && URL.revokeObjectURL(preview) });
  const picker = d.querySelector('input[type="file"]');
  d.querySelector('[data-pick-cover]').addEventListener('click', () => picker.click());
  picker.addEventListener('change', () => {
    const f = picker.files[0];
    picker.value = '';
    if (!f) return;
    if (!/^image\/(jpeg|png|webp)$/.test(f.type)) return toast('Escolha uma imagem JPG, PNG ou WebP', { error: true });
    if (f.size > 5 * 1024 * 1024) return toast('Imagem grande demais (até 5 MB)', { error: true });
    file = f;
    if (preview) URL.revokeObjectURL(preview);
    preview = URL.createObjectURL(f);
    d.querySelector('.edit-cover .cover').replaceWith(el(coverHTML({ title: b.title, authors: b.authors, src: preview })));
  });
  d.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const title = form.elements.title.value.trim();
    if (!title) return form.elements.title.focus();
    const authors = form.elements.authors.value.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
    const btn = form.querySelector('.btn.primary');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Salvando';
    try {
      let u = await api.update(b.id, { title, authors });
      if (file) u = await api.setCover(b.id, file);
      keepBook(u);
      d.close();
      showLibrary(); // the "Continuar lendo" card may show this book too
    } catch (err) {
      toast(err.message, { error: true });
      btn.disabled = false;
      btn.textContent = 'Salvar';
    }
  });
}

view.addEventListener('click', async (e) => {
  const suggest = e.target.closest('[data-suggest]');
  if (suggest) return go(`#/busca?${new URLSearchParams({ q: suggest.dataset.suggest })}`);

  const filter = e.target.closest('[data-filter]');
  if (filter) {
    shelf.filter = filter.dataset.filter;
    saveShelf();
    return renderShelf();
  }
  if (e.target.closest('[data-new-collection]')) return newCollection();
  if (e.target.closest('[data-dismiss-update]')) {
    try { localStorage.setItem(UPDATE_KEY, update.version); } catch { /* ignore */ }
    return view.querySelector('.update')?.remove();
  }

  const menuButton = e.target.closest('[data-book-menu], [data-sort-menu], [data-collection-menu]');
  if (menuButton) {
    e.stopPropagation();
    if (justClosed(menuButton)) return;
    const d = menuButton.dataset;
    if (d.bookMenu) {
      const b = library.find((x) => x.id === d.bookMenu);
      if (b) bookMenu(b, menuButton);
    } else if ('sortMenu' in d) sortMenu(menuButton);
    else {
      const c = collections.find((x) => x.id === shelf.filter);
      if (c) collectionMenu(c, menuButton);
    }
    return;
  }
  const card = e.target.closest('.book, .continue');
  if (card) go(`#/ler/${card.dataset.id}`);
});
view.addEventListener('contextmenu', (e) => {
  const card = e.target.closest('.book, .continue');
  const b = card && library.find((x) => x.id === card.dataset.id);
  if (!b) return;
  e.preventDefault();
  bookMenu(b, { x: e.clientX, y: e.clientY });
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
  // On a phone the row scrolls sideways: keep the chosen source in sight.
  view.querySelector('.chips [aria-pressed="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
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
      ${s.kind === 'external' ? `<button class="icon-btn" data-del-source="${esc(s.id.slice(4))}" title="Remover fonte"><svg class="icon"><use href="#i-trash"/></svg></button>` : ''}
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
  const del = e.target.closest('[data-del], [data-del-source]');
  if (!del) return;
  if (del.dataset.delSource) {
    const s = sources.find((x) => x.id === `ext:${del.dataset.delSource}`);
    if (!confirm(`Remover a fonte “${s?.name}”? Os livros baixados dela continuam na estante.`)) return;
    await api.removeSource(del.dataset.delSource);
  } else {
    await api.removeCatalog(del.dataset.del);
  }
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

// iOS app: sources that don't come with it, from a link or a file (mobile/sandbox.js).
if (native) {
  const section = document.getElementById('add-source');
  const linkForm = document.getElementById('add-source-link');
  const fileInput = document.getElementById('source-file');
  section.hidden = false;

  const addSource = async (body, btn, label) => {
    if (!confirm('Adicionar esta fonte? Ela não faz parte da Estante e você a usa por sua conta. Ela roda isolada: só busca na internet e devolve resultados.')) return false;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Verificando';
    try {
      const s = await api.addSource(body);
      sources = await api.sources();
      renderSources();
      toast(s.optIn ? `Fonte “${s.name}” adicionada. Ligue-a na lista para ela entrar na busca “Todas”.` : `Fonte “${s.name}” adicionada`, { timeout: 6000 });
      return true;
    } catch (err) {
      toast(err.message, { error: true, timeout: 7000 });
      return false;
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  };

  linkForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!(await addSource({ url: linkForm.url.value.trim() }, linkForm.querySelector('[type="submit"]'), 'Adicionar'))) return;
    linkForm.reset();
    linkForm.url.blur(); // puts the keyboard away, so the toast shows
  });
  document.getElementById('pick-source').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    fileInput.value = '';
    if (file) addSource({ code: await file.text() }, document.getElementById('pick-source'), 'Importar arquivo…');
  });
}

// ---------- start ----------
api.sources().then((s) => { sources = s; }).catch(() => {});
route();
