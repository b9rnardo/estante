// Lazy loaders so the library screen stays light; readers pull these on first use.

const scripts = new Map();
function script(src) {
  if (!scripts.has(src)) {
    scripts.set(src, new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error(`Falha ao carregar ${src}`));
      document.head.append(s);
    }));
  }
  return scripts.get(src);
}

export async function loadEpub() {
  await script('/vendor/jszip/jszip.min.js'); // epub.js expects a global JSZip
  await script('/vendor/epubjs/epub.min.js');
  return window.ePub;
}

let pdfjs;
export async function loadPdf() {
  if (!pdfjs) {
    // The legacy build ships polyfills, so it also runs on older Safari versions.
    pdfjs = await import('/vendor/pdfjs/legacy/build/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/legacy/build/pdf.worker.min.mjs';
  }
  return pdfjs;
}

export const PDF_OPTIONS = {
  cMapUrl: '/vendor/pdfjs/cmaps/',
  cMapPacked: true,
  standardFontDataUrl: '/vendor/pdfjs/standard_fonts/',
  wasmUrl: '/vendor/pdfjs/wasm/',
  iccUrl: '/vendor/pdfjs/iccs/',
};
