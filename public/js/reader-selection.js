// What happens around selected text: the floating toolbar (highlight colours, note,
// dictionary, copy, search) and the cards it opens (note editor, dictionary).
import { el, esc, toast, copyText } from './dom.js';
import { dictionaryCard } from './reader-dict.js';

export const COLORS = [['yellow', 'Amarelo'], ['green', 'Verde'], ['blue', 'Azul'], ['pink', 'Rosa']];
const TOP_BAR = 56;
const DOCKED = matchMedia('(hover: none)');

const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
// Words and short phrases only; a whole paragraph is not a dictionary lookup.
const definable = (text) => text.length <= 60 && text.split(/\s+/).length <= 4;

export function createSelection({ root, marks, getEngine, getLang, onSearch }) {
  const bar = el(`
    <div class="r-sel" role="toolbar" aria-label="Texto selecionado" hidden>
      <div class="r-sel-colors">
        ${COLORS.map(([c, name]) => `<button class="dot hl-${c}" data-color="${c}" title="${name}" aria-label="Destacar em ${name.toLowerCase()}"></button>`).join('')}
      </div>
      <span class="r-sel-sep"></span>
      <button class="icon-btn" data-sel="note" title="Nota"><svg class="icon"><use href="#i-note"/></svg></button>
      <button class="icon-btn" data-sel="define" title="Dicionário"><svg class="icon"><use href="#i-book"/></svg></button>
      <button class="icon-btn" data-sel="copy" title="Copiar"><svg class="icon"><use href="#i-copy"/></svg></button>
      <button class="icon-btn" data-sel="search" title="Buscar no livro"><svg class="icon"><use href="#i-search"/></svg></button>
      <button class="icon-btn" data-sel="delete" title="Apagar destaque"><svg class="icon"><use href="#i-trash"/></svg></button>
    </div>`);
  const card = el(`<div class="r-card" role="dialog" hidden></div>`);
  root.append(bar, card);

  let sel = null; // { at, text, rect } of text just selected
  let active = null; // the highlight that was clicked
  let rect = null; // where on screen the toolbar and cards point to
  let cardDone = null; // (save: boolean) => void, while a card is open

  // Above the text if there is room under the top bar, otherwise below it. On a touch screen the
  // system draws its own menu (Copy, Look Up…) by the selection, above or below it, so there the
  // toolbar keeps out of its way over the bottom bar (.r-sel.docked).
  function place(node) {
    node.hidden = false;
    if (node === bar) {
      bar.classList.toggle('docked', DOCKED.matches);
      if (DOCKED.matches) {
        bar.style.left = bar.style.top = '';
        return;
      }
    }
    const W = root.clientWidth;
    const H = root.clientHeight;
    const w = node.offsetWidth;
    const h = node.offsetHeight;
    const gap = 10;
    if (!rect) {
      node.style.left = `${(W - w) / 2}px`;
      node.style.top = `${Math.max(TOP_BAR, (H - h) / 2)}px`;
      return;
    }
    const cx = (rect.left + rect.right) / 2;
    const left = Math.min(Math.max(gap, cx - w / 2), W - w - gap);
    let top = rect.top - h - gap;
    if (top < TOP_BAR) top = rect.bottom + gap;
    if (top + h > H - gap) top = Math.max(TOP_BAR, H - h - gap);
    node.style.left = `${left}px`;
    node.style.top = `${top}px`;
  }

  function showBar() {
    const text = active?.text ?? sel.text;
    bar.querySelectorAll('[data-color]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.color === active?.color)));
    bar.querySelector('[data-sel="note"]').title = active?.note ? 'Editar nota' : 'Nota';
    bar.querySelector('[data-sel="define"]').hidden = !definable(text);
    bar.querySelector('[data-sel="search"]').hidden = !!active;
    bar.querySelector('[data-sel="delete"]').hidden = !active;
    place(bar);
  }

  function hideBar(clearSelection) {
    bar.hidden = true;
    if (clearSelection) getEngine()?.clearSelection();
    sel = null;
    if (!cardDone) active = null;
  }

  function closeCard(save) {
    if (!cardDone) return;
    const done = cardDone;
    cardDone = null;
    done(save);
    card.hidden = true;
    card.replaceChildren();
    active = null;
    getEngine()?.clearSelection();
  }

  function highlight(color) {
    const a = marks.addAnnotation({ at: sel.at, text: sel.text, color });
    getEngine().clearSelection();
    sel = null;
    return a;
  }

  function openNote(a) {
    bar.hidden = true;
    active = a;
    card.className = 'r-card r-note-card';
    card.setAttribute('aria-label', 'Nota');
    card.innerHTML = `
      <blockquote class="r-quote hl-${a.color}">${esc(clip(a.text, 200))}</blockquote>
      <textarea rows="4" placeholder="Escreva uma nota…" aria-label="Nota">${esc(a.note)}</textarea>
      <div class="r-card-actions"><button class="btn" data-card="cancel">Cancelar</button><button class="btn primary" data-card="save">Salvar</button></div>`;
    const ta = card.querySelector('textarea');
    cardDone = (save) => {
      const note = ta.value.trim();
      if (save && note !== a.note) marks.updateAnnotation(a.id, { note });
    };
    place(card);
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  }

  function openDictionary(text) {
    bar.hidden = true;
    const dict = dictionaryCard({ lang: getLang(), onClose: () => closeCard(false), onResize: () => cardDone && place(card) });
    card.className = 'r-card r-dict-card';
    card.setAttribute('aria-label', 'Dicionário');
    card.replaceChildren(dict.el);
    cardDone = () => dict.abort();
    place(card);
    dict.show(text);
    // The card takes the system menu's place by the text, so the selection that keeps it up goes.
    if (DOCKED.matches) getEngine()?.clearSelection();
  }

  // The toolbar must not steal the selection it acts on.
  bar.addEventListener('mousedown', (e) => e.preventDefault());
  bar.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const text = active?.text ?? sel?.text ?? '';
    if (b.dataset.color) {
      if (active) marks.updateAnnotation(active.id, { color: b.dataset.color });
      else highlight(b.dataset.color);
      hideBar(false);
      return;
    }
    switch (b.dataset.sel) {
      case 'note': openNote(active ?? highlight('yellow')); break;
      case 'define': openDictionary(text); break;
      case 'copy':
        copyText(text).then(() => toast('Texto copiado'));
        hideBar(true);
        break;
      case 'search':
        hideBar(true);
        onSearch(text);
        break;
      case 'delete':
        marks.removeAnnotation(active.id);
        hideBar(false);
        break;
    }
  });

  card.addEventListener('click', (e) => {
    const act = e.target.closest('[data-card]')?.dataset.card;
    if (act) closeCard(act === 'save');
  });
  card.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); closeCard(true); }
  });

  return {
    onSelect(s) {
      if (!s) {
        if (!cardDone) hideBar(false);
        return;
      }
      closeCard(true);
      active = null;
      sel = s;
      rect = s.rect;
      showBar();
    },
    onMarkClick(id, r) {
      const a = marks.get(id);
      if (!a) return;
      closeCard(true);
      sel = null;
      active = a;
      rect = r;
      showBar();
    },
    // Turning the page leaves the toolbar pointing at nothing; an open card stays.
    onRelocate() {
      if (!bar.hidden && !cardDone) hideBar(false);
    },
    isOpen: () => !bar.hidden || !!cardDone,
    // A click elsewhere on the page keeps what was typed; Esc throws it away.
    dismiss() {
      if (cardDone) closeCard(true);
      else hideBar(true);
    },
    cancel() {
      if (cardDone) closeCard(false);
      else hideBar(true);
    },
  };
}
