// Book records as library.json keeps them. Shared by the server (library.js) and the iOS app
// (mobile/library.js), so a library copied from one to the other reads the same.

export function newBook({ id, file, format, size, cover, meta = {}, source, sourceId }) {
  return {
    id,
    title: String(meta.title ?? 'Sem título').slice(0, 300),
    authors: Array.isArray(meta.authors) ? meta.authors.map(String).slice(0, 5) : [],
    year: meta.year ?? null,
    language: meta.language ?? null,
    format,
    file,
    size,
    cover,
    source,
    sourceId,
    addedAt: new Date().toISOString(),
    lastOpenedAt: null,
    progress: null,
  };
}

// --- bookmarks and highlights, as sent by the reader ---
const COLORS = ['yellow', 'green', 'blue', 'pink'];
const text = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
const fraction = (v) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : null);

// A position is an EPUB CFI, a PDF page number, or a PDF page plus the highlighted
// rectangles (fractions of the page size).
function position(at) {
  if (typeof at === 'string') return at.slice(0, 2000) || null;
  if (Number.isInteger(at) && at > 0) return at;
  if (Number.isInteger(at?.page) && at.page > 0 && Array.isArray(at.rects)) {
    const rects = at.rects
      .filter((r) => Array.isArray(r) && r.length === 4 && r.every(Number.isFinite))
      .slice(0, 300)
      .map((r) => r.map((n) => Math.round(n * 1e4) / 1e4));
    return rects.length ? { page: at.page, rects } : null;
  }
  return null;
}

function mark(m, withText) {
  const at = position(m?.at);
  const id = text(m?.id, 64);
  if (!at || !id) return null;
  const out = { id, at, label: text(m.label, 300), percent: fraction(m.percent), createdAt: text(m.createdAt, 40) };
  if (!withText) return { ...out, excerpt: text(m.excerpt, 400) };
  return {
    ...out,
    text: text(m.text, 5000),
    note: text(m.note, 20000),
    color: COLORS.includes(m.color) ? m.color : COLORS[0],
    updatedAt: text(m.updatedAt, 40),
  };
}
const marks = (list, max, withText) => list.slice(0, max).map((m) => mark(m, withText)).filter(Boolean);

// Only fields the reader and the shelf legitimately change. `collections` are the ones that
// exist, so a book can't be put in a collection that was deleted meanwhile.
export function applyPatch(b, patch, collections) {
  const now = new Date().toISOString();
  if (patch.progress !== undefined) b.progress = patch.progress && { ...patch.progress, updatedAt: now };
  if (patch.opened) b.lastOpenedAt = now;
  if (typeof patch.title === 'string' && patch.title.trim()) b.title = patch.title.trim().slice(0, 300);
  if (Array.isArray(patch.authors)) b.authors = patch.authors.map((a) => String(a).trim()).filter(Boolean).slice(0, 5);
  if (Array.isArray(patch.bookmarks)) b.bookmarks = marks(patch.bookmarks, 2000, false);
  if (Array.isArray(patch.annotations)) b.annotations = marks(patch.annotations, 5000, true);
  if (typeof patch.finished === 'boolean') b.finishedAt = patch.finished ? b.finishedAt ?? now : null;
  if (Array.isArray(patch.collections)) {
    b.collections = [...new Set(patch.collections)].filter((c) => collections.some((x) => x.id === c));
  }
  return b;
}
