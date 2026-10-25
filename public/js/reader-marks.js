// Bookmarks and highlights (with optional notes) for the open book: the data, the lists in
// the side panel, the bookmark button and the Markdown export. Saved on the book record.
import { api, native } from './api.js';
import { esc, toast, uid, copyText } from './dom.js';

const dateFmt = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'short' });
const day = (iso) => { try { return dateFmt.format(new Date(iso)); } catch { return ''; } };
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

export function createMarks({ root, book, isPdf, getEngine, onGoTo }) {
  book.bookmarks ??= [];
  book.annotations ??= [];
  const bmButton = root.querySelector('[data-act="bookmark"]');
  const ribbon = root.querySelector('.r-ribbon');
  const bmList = root.querySelector('[data-tab="bookmarks"] .r-list');
  const noteList = root.querySelector('[data-tab="notes"] .r-list');
  const noteFoot = root.querySelector('[data-tab="notes"] footer');

  // One request at a time per field, always with the latest list.
  const timers = {};
  let chain = Promise.resolve();
  function persist(field) {
    clearTimeout(timers[field]);
    timers[field] = setTimeout(() => {
      timers[field] = null;
      chain = chain
        .then(() => api.update(book.id, { [field]: book[field] }))
        .catch(() => toast('Não consegui salvar. Verifique se a Estante ainda está aberta.', { error: true }));
    }, 300);
  }
  const flush = () => {
    for (const field of Object.keys(timers)) {
      if (!timers[field]) continue;
      clearTimeout(timers[field]);
      api.update(book.id, { [field]: book[field] }).catch(() => {});
    }
  };

  function sorted(list) {
    const engine = getEngine();
    try {
      return [...list].sort((a, b) => engine.compare(a.at, b.at));
    } catch {
      return list;
    }
  }

  const meta = (m) => [m.label, !isPdf && m.percent != null ? `${Math.round(m.percent * 100)}%` : '', day(m.createdAt)]
    .filter(Boolean).map(esc).join(' · ');

  function render() {
    const bms = sorted(book.bookmarks);
    bmList.innerHTML = bms.length
      ? bms.map((b) => `
        <li>
          <a href="#" data-goto-bookmark="${esc(b.id)}">
            <span class="r-item-title">${esc(b.label || 'Marcador')}</span>
            ${b.excerpt ? `<span class="r-item-text">${esc(clip(b.excerpt, 140))}</span>` : ''}
            <span class="r-item-meta">${meta({ ...b, label: '' })}</span>
          </a>
          <button class="icon-btn" data-del-bookmark="${esc(b.id)}" title="Remover marcador"><svg class="icon"><use href="#i-x"/></svg></button>
        </li>`).join('')
      : `<li class="r-empty">Nenhum marcador ainda.<br>Toque em <svg class="icon"><use href="#i-bookmark"/></svg> para marcar a página em que você está.</li>`;

    const notes = sorted(book.annotations);
    noteList.innerHTML = notes.length
      ? notes.map((a) => `
        <li data-note="${esc(a.id)}">
          <a href="#" data-goto-note="${esc(a.id)}">
            <blockquote class="r-quote hl-${a.color}">${esc(clip(a.text, 280))}</blockquote>
            ${a.note ? `<p class="r-note-text">${esc(a.note)}</p>` : ''}
            <span class="r-item-meta">${meta(a)}</span>
          </a>
          <div class="r-item-actions">
            <button class="icon-btn" data-edit-note="${esc(a.id)}" title="${a.note ? 'Editar nota' : 'Escrever nota'}"><svg class="icon"><use href="#i-note"/></svg></button>
            <button class="icon-btn" data-del-note="${esc(a.id)}" title="Apagar destaque"><svg class="icon"><use href="#i-trash"/></svg></button>
          </div>
        </li>`).join('')
      : `<li class="r-empty">Nenhum destaque ainda.<br>Selecione um trecho do texto para destacar ou escrever uma nota.</li>`;
    noteFoot.hidden = !notes.length;
    noteFoot.querySelector('.count').textContent = notes.length === 1 ? '1 destaque' : `${notes.length} destaques`;
  }

  // The page on screen holds a bookmark: filled icon in the bar, ribbon on the page.
  function sync() {
    const engine = getEngine();
    const on = !!engine && book.bookmarks.some((b) => engine.contains(b.at));
    bmButton.setAttribute('aria-pressed', String(on));
    bmButton.title = on ? 'Remover marcador' : 'Marcar esta página';
    ribbon.hidden = !on;
  }

  function changed(field) {
    persist(field);
    render();
    sync();
  }

  async function toggleBookmark() {
    const engine = getEngine();
    if (!engine) return;
    const here = book.bookmarks.filter((b) => engine.contains(b.at));
    if (here.length) {
      book.bookmarks = book.bookmarks.filter((b) => !here.includes(b));
      toast('Marcador removido', { action: 'Desfazer', onAction: () => { book.bookmarks.push(...here); changed('bookmarks'); } });
    } else {
      const loc = await engine.location();
      if (!loc) return;
      book.bookmarks.push({ id: uid(), ...loc, createdAt: new Date().toISOString() });
    }
    changed('bookmarks');
  }

  // --- highlights ---
  const get = (id) => book.annotations.find((a) => a.id === id);

  function addAnnotation({ at, text, color, note = '' }) {
    const engine = getEngine();
    const now = new Date().toISOString();
    const a = { id: uid(), at, text, note, color, label: engine.labelOf(at), percent: engine.percentOf(at), createdAt: now, updatedAt: now };
    book.annotations.push(a);
    engine.addHighlight(a);
    changed('annotations');
    return a;
  }

  function updateAnnotation(id, patch) {
    const a = get(id);
    if (!a) return;
    Object.assign(a, patch, { updatedAt: new Date().toISOString() });
    if (patch.color) getEngine()?.addHighlight(a);
    changed('annotations');
  }

  function removeAnnotation(id) {
    const a = get(id);
    if (!a) return;
    book.annotations = book.annotations.filter((x) => x !== a);
    getEngine()?.removeHighlight(id);
    changed('annotations');
    toast(a.note ? 'Destaque e nota apagados' : 'Destaque apagado', {
      action: 'Desfazer',
      onAction: () => {
        book.annotations.push(a);
        getEngine()?.addHighlight(a);
        changed('annotations');
      },
    });
  }

  // --- export ---
  function markdown() {
    const lines = [`# ${book.title}`, ''];
    if (book.authors?.length) lines.push(book.authors.join(', '), '');
    let section = null;
    for (const a of sorted(book.annotations)) {
      if (a.label && a.label !== section) {
        section = a.label;
        lines.push(`## ${section}`, '');
      }
      lines.push(...a.text.split('\n').map((l) => `> ${l}`), '');
      if (a.note) lines.push(a.note, '');
    }
    return `${lines.join('\n').trim()}\n`;
  }
  function download() {
    const name = `${book.title.replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80) || 'Notas'} — notas.md`;
    // The iOS app can't save a download: the file goes out through the share sheet instead.
    if (native) return native.shareText(name, markdown()).catch((err) => toast(err.message, { error: true }));
    const url = URL.createObjectURL(new Blob([markdown()], { type: 'text/markdown;charset=utf-8' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  // Notes are edited right in the list.
  function editInList(id) {
    const a = get(id);
    const li = noteList.querySelector(`[data-note="${CSS.escape(id)}"]`);
    if (!a || !li || li.querySelector('textarea')) return;
    const form = document.createElement('div');
    form.className = 'r-note-edit';
    form.innerHTML = `<textarea rows="3" placeholder="Escreva uma nota…" aria-label="Nota">${esc(a.note)}</textarea>
      <div class="r-card-actions"><button class="btn" data-note-act="cancel">Cancelar</button><button class="btn primary" data-note-act="save">Salvar</button></div>`;
    li.querySelector('.r-note-text')?.remove();
    li.append(form);
    const ta = form.querySelector('textarea');
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
    const done = (save) => (save ? updateAnnotation(id, { note: ta.value.trim() }) : render());
    form.addEventListener('click', (e) => {
      const act = e.target.closest('[data-note-act]')?.dataset.noteAct;
      if (act) done(act === 'save');
    });
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) done(true);
      if (e.key === 'Escape') { e.stopPropagation(); done(false); }
    });
  }

  root.querySelector('.r-panel-body').addEventListener('click', (e) => {
    const t = e.target.closest('[data-goto-bookmark], [data-goto-note], [data-del-bookmark], [data-del-note], [data-edit-note], [data-act]');
    if (!t) return;
    const d = t.dataset;
    if (d.gotoBookmark || d.gotoNote) {
      e.preventDefault();
      const m = d.gotoBookmark ? book.bookmarks.find((b) => b.id === d.gotoBookmark) : get(d.gotoNote);
      if (m) onGoTo(m.at);
    } else if (d.delBookmark) {
      const b = book.bookmarks.find((x) => x.id === d.delBookmark);
      book.bookmarks = book.bookmarks.filter((x) => x !== b);
      changed('bookmarks');
      toast('Marcador removido', { action: 'Desfazer', onAction: () => { book.bookmarks.push(b); changed('bookmarks'); } });
    } else if (d.delNote) removeAnnotation(d.delNote);
    else if (d.editNote) editInList(d.editNote);
    else if (d.act === 'export-notes') download();
    else if (d.act === 'copy-notes') copyText(markdown()).then(() => toast('Notas copiadas em Markdown'));
  });

  return {
    attach() {
      for (const a of book.annotations) {
        try { getEngine().addHighlight(a); } catch (err) { console.warn('highlight', a.id, err); }
      }
      render();
      sync();
    },
    render,
    sync,
    flush,
    toggleBookmark,
    get,
    addAnnotation,
    updateAnnotation,
    removeAnnotation,
  };
}
