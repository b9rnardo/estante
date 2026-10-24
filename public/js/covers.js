// Gives coverless books (arXiv papers, imported files) a real cover: the EPUB's
// own cover image, or the first page of the PDF.
import { api, fileUrl } from './api.js';
import { loadEpub, loadPdf, PDF_OPTIONS } from './vendor.js';

async function epubCover(book) {
  const ePub = await loadEpub();
  const buf = await (await fetch(fileUrl(book))).arrayBuffer();
  const doc = ePub(buf);
  try {
    // Destroying before epub.js finishes opening leaves its own promises throwing.
    await doc.opened;
    const url = await doc.coverUrl();
    return url ? await (await fetch(url)).blob() : null;
  } finally {
    doc.destroy();
  }
}

async function pdfCover(book) {
  const pdfjs = await loadPdf();
  const task = pdfjs.getDocument({ url: fileUrl(book), ...PDF_OPTIONS });
  const doc = await task.promise;
  try {
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: 420 / base.width });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    await page.render({ canvas, viewport }).promise;
    return await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.85));
  } finally {
    task.destroy();
  }
}

const tried = new Set();
let chain = Promise.resolve();

// Runs one book at a time in the background; returns the updated record or null.
export function ensureCover(book) {
  if (book.cover || tried.has(book.id)) return Promise.resolve(null);
  tried.add(book.id);
  const job = chain.then(async () => {
    try {
      const blob = book.format === 'epub' ? await epubCover(book) : await pdfCover(book);
      return blob ? await api.setCover(book.id, blob) : null;
    } catch (err) {
      console.warn('Capa não gerada para', book.title, err);
      return null;
    }
  });
  chain = job;
  return job;
}

// Book-ish placeholder colour derived from the title, so it stays stable.
const PALETTE = ['#6b5e4e', '#4f5d6b', '#5e6b4f', '#6b4f5a', '#4f6b66', '#6b604f', '#58506b', '#7a5440'];
export function placeholderColor(title = '') {
  let h = 0;
  for (const c of title) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
