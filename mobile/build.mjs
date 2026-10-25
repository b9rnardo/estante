// Builds what goes into the iOS app (npm run ios), and what stays out of it:
//   mobile/www/            the app's web content (webDir in capacitor.config.json): public/, the
//                          libraries server/index.js serves from node_modules, and js/native-api.js,
//                          the API answered inside the app (mobile/server.js and what it imports)
//   dist/fontes/libgen.js  Library Genesis as an external source (Fontes › Adicionar fonte),
//                          made from server/sources/libgen.js
import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const at = (...parts) => path.join(ROOT, ...parts);
const WWW = at('mobile', 'www');

await rm(WWW, { recursive: true, force: true });
await cp(at('public'), WWW, { recursive: true, filter: (src) => !src.endsWith('.DS_Store') });

// Where server/index.js serves them (its STATIC table), just the files public/js/vendor.js loads.
const VENDOR = [
  ['epubjs/dist/epub.min.js', 'epubjs/epub.min.js'],
  ['jszip/dist/jszip.min.js', 'jszip/jszip.min.js'],
  ['pdfjs-dist/legacy/build/pdf.min.mjs', 'pdfjs/legacy/build/pdf.min.mjs'],
  ['pdfjs-dist/legacy/build/pdf.worker.min.mjs', 'pdfjs/legacy/build/pdf.worker.min.mjs'],
  ['pdfjs-dist/cmaps', 'pdfjs/cmaps'],
  ['pdfjs-dist/standard_fonts', 'pdfjs/standard_fonts'],
  ['pdfjs-dist/wasm', 'pdfjs/wasm'],
  ['pdfjs-dist/iccs', 'pdfjs/iccs'],
];
for (const [from, to] of VENDOR) await cp(at('node_modules', from), path.join(WWW, 'vendor', to), { recursive: true });

// Points the imports matching `filter` (from files whose path matches `importer`) at `file`.
const swap = (filter, file, importer = /./) => ({
  name: `swap ${filter}`,
  setup(b) {
    b.onResolve({ filter }, (args) => (importer.test(args.importer) ? { path: file } : undefined));
  },
});

const common = { bundle: true, format: 'esm', platform: 'browser', target: 'safari15', charset: 'utf8', legalComments: 'none', logLevel: 'warning' };

await build({
  ...common,
  entryPoints: [at('mobile', 'server.js')],
  outfile: path.join(WWW, 'js', 'native-api.js'),
  plugins: [swap(/^node:crypto$/, at('mobile', 'crypto.js'))],
});

await mkdir(at('dist', 'fontes'), { recursive: true });
await build({
  ...common,
  entryPoints: [at('server', 'sources', 'libgen.js')],
  outfile: at('dist', 'fontes', 'libgen.js'),
  plugins: [swap(/\/http\.js$/, at('mobile', 'source-http.js'), /[\\/]server[\\/]sources[\\/]/)],
  banner: { js: '// Library Genesis, fonte externa da Estante no iOS: adicione em Fontes › Adicionar fonte.\n// Gerada por mobile/build.mjs a partir de server/sources/libgen.js.' },
});

console.log('mobile/www e dist/fontes/libgen.js prontos');
