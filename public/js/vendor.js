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

// pdf.js reads a page's text with `for await` over a ReadableStream, which WebKit (Safari, the
// iOS app) can't do yet. Without it, PDFs there have no text to select, search or restyle.
function streamIteration() {
  if (typeof ReadableStream === 'undefined' || ReadableStream.prototype[Symbol.asyncIterator]) return;
  ReadableStream.prototype[Symbol.asyncIterator] = async function* iterate() {
    const reader = this.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        yield value;
      }
    } finally {
      reader.releaseLock();
    }
  };
}

let pdfjs;
export async function loadPdf() {
  if (!pdfjs) {
    streamIteration();
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
