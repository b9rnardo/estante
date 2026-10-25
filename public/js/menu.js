// Small popup menus (sort order, a book's actions), anchored to a button or to the pointer.
// Items: { label, icon, onSelect, danger?, checked? } or '-' for a separator.
import { esc } from './dom.js';

let open = null;

// Opened from the keyboard, the menu focuses an item; by mouse or touch, only itself.
let viaKeyboard = false;
document.addEventListener('keydown', () => { viaKeyboard = true; }, true);
document.addEventListener('pointerdown', () => { viaKeyboard = false; }, true);

export function closeMenu({ refocus = false } = {}) {
  if (!open) return;
  const { menu, anchor, cleanup } = open;
  open = null;
  cleanup();
  menu.remove();
  anchor?.setAttribute?.('aria-expanded', 'false');
  if (refocus) anchor?.focus?.();
}

export function openMenu(anchor, items, { label } = {}) {
  closeMenu();
  const menu = document.createElement('div');
  menu.className = 'menu';
  menu.setAttribute('role', 'menu');
  menu.tabIndex = -1;
  if (label) menu.setAttribute('aria-label', label);
  menu.innerHTML = items.map((it, i) => {
    if (it === '-') return '<hr>';
    const radio = it.checked !== undefined;
    return `<button type="button" data-i="${i}" class="${it.danger ? 'danger' : ''}"
      role="${radio ? 'menuitemradio' : 'menuitem'}"${radio ? ` aria-checked="${!!it.checked}"` : ''}>
      <svg class="icon"><use href="#${radio ? 'i-check' : it.icon}"/></svg><span>${esc(it.label)}</span></button>`;
  }).join('');
  document.body.append(menu);

  // Below the anchor, right edges aligned (or at the pointer); flipped up and kept on screen.
  const r = anchor instanceof Element ? anchor.getBoundingClientRect() : { left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y };
  const pointer = !(anchor instanceof Element);
  const { width: w, height: h } = menu.getBoundingClientRect();
  const m = 8;
  let left = pointer ? r.left : r.right - w;
  let top = r.bottom + (pointer ? 2 : 6);
  if (top + h > innerHeight - m) top = Math.max(m, r.top - h - (pointer ? 2 : 6));
  left = Math.min(Math.max(m, left), innerWidth - w - m);
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;

  const buttons = [...menu.querySelectorAll('button')];
  const move = (d) => {
    const i = buttons.indexOf(document.activeElement);
    buttons[(i + d + buttons.length) % buttons.length]?.focus();
  };
  menu.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const it = items[b.dataset.i];
    closeMenu({ refocus: true });
    it.onSelect?.();
  });
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenu({ refocus: true }); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
    else if (e.key === 'Home') { e.preventDefault(); buttons[0]?.focus(); }
    else if (e.key === 'End') { e.preventDefault(); buttons.at(-1)?.focus(); }
    else if (e.key === 'Tab') closeMenu();
  };
  const onDown = (e) => {
    if (menu.contains(e.target)) return;
    // A click on the button that opened the menu closes it, instead of reopening it.
    if (anchor instanceof Element && anchor.contains(e.target)) {
      anchor.dataset.menuJustClosed = '1';
      setTimeout(() => delete anchor.dataset.menuJustClosed, 600);
    }
    closeMenu();
  };
  const onScroll = (e) => { if (!menu.contains(e.target)) closeMenu(); };
  const onBlur = () => closeMenu();
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('pointerdown', onDown, true);
  window.addEventListener('scroll', onScroll, true);
  window.addEventListener('resize', onBlur);
  window.addEventListener('blur', onBlur);
  open = {
    menu,
    anchor: anchor instanceof Element ? anchor : null,
    cleanup: () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onBlur);
      window.removeEventListener('blur', onBlur);
    },
  };
  open.anchor?.setAttribute('aria-expanded', 'true');
  ((viaKeyboard && (menu.querySelector('[aria-checked="true"]') ?? buttons[0])) || menu).focus({ preventScroll: true });
  return menu;
}

// For buttons that toggle a menu: true when this click is the one that just closed it.
export function justClosed(button) {
  if (!button.dataset.menuJustClosed) return false;
  delete button.dataset.menuJustClosed;
  return true;
}
