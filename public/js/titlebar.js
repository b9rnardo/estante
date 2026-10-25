// The system's controls drawn over the page's top edge, kept in step with the colours under them.
// Desktop app on Windows and Linux: the caption buttons (minimize, maximize, close) sit over the
// top-right corner, painted in the colours reported here (electron/preload.cjs).
// iOS app: the status bar's text turns light over a dark page and dark over a light one.
// In the browser and on a Mac there is nothing to paint.
const report = window.estante?.titleBarColors;
const cap = window.Capacitor?.isNativePlatform?.() ? window.Capacitor : null;
let source = null; // [element, background property, text property], or null for the shelf
let last = '';

function paint() {
  if (!report && !cap) return;
  const [el, bg, fg] = source ?? [document.documentElement, '--bg', '--text'];
  const css = getComputedStyle(el);
  const colors = [css.getPropertyValue(bg).trim(), css.getPropertyValue(fg).trim()];
  if (colors.join() === last) return;
  last = colors.join();
  report?.(...colors);
  // The status bar plugin's style names the background it suits: DARK gives light text.
  cap?.nativePromise('StatusBar', 'setStyle', { style: isDark(colors[0]) ? 'DARK' : 'LIGHT' }).catch(() => {});
}

// #rgb or #rrggbb, the form the colours take in css/.
function isDark(hex) {
  const h = hex.replace('#', '');
  const [r, g, b] = (h.length === 3 ? [...h].map((c) => c + c) : h.match(/../g) ?? []).map((c) => parseInt(c, 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 128;
}

// Custom properties rather than background-color/color: those animate when the reader
// changes theme, so reading them right away would give the old colours.
export function setTitleBarColors(el, bg, fg) {
  source = el ? [el, bg, fg] : null;
  paint();
}

matchMedia('(prefers-color-scheme: dark)').addEventListener('change', paint);
paint();
