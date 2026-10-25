// Modal sheets made on the fly (book details, collections, names), styled like the
// settings sheet. The desktop app has no window.prompt(), so names are asked here too.
import { el, esc } from './dom.js';

export function openSheet(title, body, { onClose } = {}) {
  const d = el(`
    <dialog class="sheet">
      <div class="sheet-head">
        <h2>${esc(title)}</h2>
        <button type="button" class="icon-btn" data-close aria-label="Fechar"><svg class="icon"><use href="#i-x"/></svg></button>
      </div>
      ${body}
    </dialog>`);
  document.body.append(d);
  d.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) return d.close();
    if (e.target !== d) return;
    const r = d.getBoundingClientRect(); // the backdrop, not the sheet's own padding
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) d.close();
  });
  d.addEventListener('close', () => {
    d.remove();
    onClose?.();
  });
  d.showModal();
  return d;
}

// Resolves with the trimmed text, or null when cancelled.
export function askText({ title, label, value = '', placeholder = '', ok = 'Salvar', maxLength = 60 }) {
  return new Promise((resolve) => {
    let result = null;
    const d = openSheet(title, `
      <form class="form">
        <label><span>${esc(label)}</span><input name="text" value="${esc(value)}" placeholder="${esc(placeholder)}" maxlength="${maxLength}" required autocomplete="off"></label>
        <div class="sheet-actions">
          <button type="button" class="btn" data-close>Cancelar</button>
          <button class="btn primary">${esc(ok)}</button>
        </div>
      </form>`, { onClose: () => resolve(result) });
    const input = d.querySelector('input');
    input.select();
    d.querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault();
      const v = input.value.trim();
      if (!v) return input.focus();
      result = v;
      d.close();
    });
  });
}
