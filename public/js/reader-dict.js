// Dictionary card for the reader: one word at a time, links inside a definition open
// that word, and the arrow goes back. Definitions come from the server (server/dictionary.js),
// so this works the same in the browser, on macOS and on Windows.
import { api } from './api.js';
import { el, esc } from './dom.js';

let names;
function langName(code) {
  try {
    names ??= new Intl.DisplayNames(['pt-BR'], { type: 'language' });
    return names.of(code);
  } catch {
    return code;
  }
}

const senseHtml = (sense) => sense
  .map((s) => (s.link ? `<a href="#" data-word="${esc(s.link)}">${esc(s.t)}</a>` : esc(s.t)))
  .join('');

export function dictionaryCard({ lang, onClose, onResize }) {
  const card = el(`
    <div class="r-dict">
      <header>
        <button class="icon-btn" data-dict="back" aria-label="Voltar" hidden><svg class="icon"><use href="#i-back"/></svg></button>
        <div class="r-dict-word"><b></b><span></span></div>
        <button class="icon-btn" data-dict="close" aria-label="Fechar"><svg class="icon"><use href="#i-x"/></svg></button>
      </header>
      <div class="r-dict-body"></div>
      <footer class="r-dict-source" hidden></footer>
    </div>`);
  const $ = (s) => card.querySelector(s);
  const history = [];
  let ctrl = null;

  async function show(word, push = true) {
    const w = word.replace(/\s+/g, ' ').trim();
    if (push) history.push(w);
    ctrl?.abort();
    ctrl = new AbortController();
    const { signal } = ctrl;
    $('[data-dict="back"]').hidden = history.length < 2;
    $('.r-dict-word b').textContent = w;
    $('.r-dict-word span').textContent = '';
    $('.r-dict-body').innerHTML = `<p class="r-dict-note"><span class="spinner"></span> Procurando…</p>`;
    $('.r-dict-source').hidden = true;
    onResize();
    try {
      const d = await api.define(w, lang, signal);
      if (signal.aborted) return;
      $('.r-dict-word b').textContent = d.word;
      $('.r-dict-word span').textContent = langName(d.lang);
      $('.r-dict-body').innerHTML = d.entries
        .map((e) => `<section><h4>${esc(e.pos)}</h4><ol>${e.senses.map((s) => `<li>${senseHtml(s)}</li>`).join('')}</ol></section>`)
        .join('');
      const source = $('.r-dict-source');
      source.innerHTML = `<a href="${esc(d.url)}" target="_blank" rel="noreferrer">Ver no Wikcionário</a>${d.source.startsWith('en.') ? '<span>Definições em inglês</span>' : ''}`;
      source.hidden = false;
    } catch (err) {
      if (signal.aborted) return;
      const search = `https://pt.wiktionary.org/w/index.php?search=${encodeURIComponent(w)}`;
      $('.r-dict-body').innerHTML = `<p class="r-dict-note">${esc(err.status ? err.message : 'Sem conexão com o dicionário.')}</p>`;
      if (err.status === 404) {
        $('.r-dict-source').innerHTML = `<a href="${esc(search)}" target="_blank" rel="noreferrer">Procurar no Wikcionário</a>`;
        $('.r-dict-source').hidden = false;
      }
    }
    onResize();
  }

  card.addEventListener('click', (e) => {
    const t = e.target.closest('a[data-word], button[data-dict]');
    if (!t) return;
    e.preventDefault();
    if (t.dataset.word) show(t.dataset.word);
    else if (t.dataset.dict === 'close') onClose();
    else if (t.dataset.dict === 'back' && history.length > 1) {
      history.pop();
      show(history[history.length - 1], false);
    }
  });

  return { el: card, show, abort: () => ctrl?.abort() };
}
