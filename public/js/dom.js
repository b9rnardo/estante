export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

// Toasts live outside the reader, so both screens can use them.
export function toast(message, { action, onAction, error = false, timeout = 4200 } = {}) {
  const t = el(`<div class="toast${error ? ' error' : ''}"><span>${esc(message)}</span>${action ? `<button class="btn">${esc(action)}</button>` : ''}</div>`);
  t.querySelector('button')?.addEventListener('click', () => { t.remove(); onAction?.(); });
  document.getElementById('toasts').append(t);
  setTimeout(() => t.remove(), timeout);
}

// crypto.randomUUID() only exists on https/localhost; the phone opens the app over plain http.
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const t = Object.assign(document.createElement('textarea'), { value: text });
    t.style.cssText = 'position:fixed;opacity:0';
    document.body.append(t);
    t.select();
    document.execCommand('copy');
    t.remove();
  }
}
