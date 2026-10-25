import http from 'node:http';
import path from 'node:path';
import { createReadStream, realpathSync } from 'node:fs';
import { stat, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import builtin from './sources/builtin.js';
import libgen from './sources/libgen.js';
import { makeCatalogSource, searchTemplate } from './sources/opds.js';
import * as lib from './library.js';
import { define } from './dictionary.js';

const PORT = Number(process.env.PORT ?? 4567);
const HOST = process.env.HOST ?? '127.0.0.1';
const ROOT = path.resolve(import.meta.dirname, '..');
const NM = path.join(ROOT, 'node_modules');

// URL prefix -> directory. Vendor libraries are served straight from node_modules.
const STATIC = [
  ['/vendor/epubjs/', path.join(NM, 'epubjs', 'dist')],
  ['/vendor/jszip/', path.join(NM, 'jszip', 'dist')],
  ['/vendor/pdfjs/', path.join(NM, 'pdfjs-dist')],
  ['/', path.join(ROOT, 'public')],
];

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.wasm': 'application/wasm',
  '.bcmap': 'application/octet-stream', '.pfb': 'application/octet-stream', '.ttf': 'font/ttf', '.icc': 'application/vnd.iccprofile',
  '.epub': 'application/epub+zip', '.pdf': 'application/pdf', '.map': 'application/json',
};

function sources() {
  return [...[...builtin, libgen].map((s) => ({ ...s, kind: 'builtin' })), ...lib.catalogs().map(makeCatalogSource)];
}

const hideCreds = (url) => {
  const u = new URL(url);
  if (u.password) u.password = '•••';
  return u.toString();
};

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function body(req) {
  const chunks = [];
  let n = 0;
  for await (const c of req) {
    if ((n += c.length) > 8e6) throw new HttpError(413, 'Requisição grande demais');
    chunks.push(c);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { throw new HttpError(400, 'JSON inválido'); }
}

// Serves a file with Range support so pdf.js can stream large PDFs page by page.
async function sendFile(req, res, file, { cache = 'no-cache' } = {}) {
  const st = await stat(file).catch(() => null);
  if (!st?.isFile()) return send(res, 404, { error: 'Não encontrado' });
  const headers = {
    'Content-Type': TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    'Cache-Control': cache,
    'Last-Modified': st.mtime.toUTCString(),
  };
  const range = req.headers.range?.match(/^bytes=(\d*)-(\d*)$/);
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : st.size - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : st.size - 1;
    start = Math.max(0, start);
    end = Math.min(end, st.size - 1);
    if (start > end) {
      res.writeHead(416, { 'Content-Range': `bytes */${st.size}` });
      return res.end();
    }
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1 });
    return createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { ...headers, 'Content-Length': st.size });
  if (req.method === 'HEAD') return res.end();
  createReadStream(file).pipe(res);
}

async function serveStatic(req, res, pathname) {
  for (const [prefix, dir] of STATIC) {
    if (!pathname.startsWith(prefix)) continue;
    let rel = decodeURIComponent(pathname.slice(prefix.length));
    if (!rel || rel.endsWith('/')) rel += 'index.html';
    const file = path.resolve(dir, rel);
    if (!file.startsWith(dir + path.sep)) return send(res, 403, { error: 'Proibido' });
    return sendFile(req, res, file, { cache: prefix.startsWith('/vendor') ? 'max-age=86400' : 'no-cache' });
  }
  send(res, 404, { error: 'Não encontrado' });
}

const routes = [];
const route = (method, pattern, handler) => routes.push({ method, pattern: new RegExp(`^${pattern}$`), handler });

route('GET', '/api/sources', () => sources().map(({ id, name, description, kind, optIn = false }) => ({ id, name, description, kind, optIn })));

route('GET', '/api/search', async ({ url }) => {
  const q = url.searchParams.get('q')?.trim();
  const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
  const src = sources().find((s) => s.id === url.searchParams.get('source'));
  if (!q) throw new HttpError(400, 'Digite algo para buscar');
  if (!src) throw new HttpError(404, 'Fonte desconhecida');
  const { results, hasMore } = await src.search(q, page);
  // Mark what is already on the shelf so the UI can show "Ler" instead of "Baixar".
  for (const r of results) {
    r.source = src.id;
    r.inLibrary = r.formats.map((f) => lib.findBySource(src.id, r.id, f)?.id).filter(Boolean)[0] ?? null;
  }
  return { results, hasMore };
});

route('GET', '/api/library', () => lib.list());

// Books assembled chapter by chapter take minutes, so they run as jobs the
// client polls for progress instead of holding the request open.
const jobs = new Map();
const jobView = ({ id, done, total, book, error }) => ({ id, done, total, book, error });
const runningJob = (key) => [...jobs.values()].find((j) => j.key === key && !j.book && !j.error);

function startJob(key, task) {
  const job = { id: randomUUID(), key, done: 0, total: null, book: null, error: null };
  jobs.set(job.id, job);
  task((done, total) => Object.assign(job, { done, total }))
    .then((book) => { job.book = book; })
    .catch((err) => {
      console.error(`[job ${key}]`, err.message);
      job.error = err.name === 'TimeoutError' ? 'A fonte demorou demais para responder' : err.message;
    })
    .finally(() => setTimeout(() => jobs.delete(job.id), 10 * 60 * 1000).unref());
  return job;
}

route('POST', '/api/library', async ({ req }) => {
  const { source, id, format, url: hint, meta } = await body(req);
  const src = sources().find((s) => s.id === source);
  if (!src) throw new HttpError(404, 'Fonte desconhecida');
  if (!['epub', 'pdf', 'auto'].includes(format)) throw new HttpError(400, 'Formato inválido');
  const existing = lib.findBySource(source, id, format);
  if (existing) return existing;
  const key = `${source}:${id}:${format}`;
  const running = runningJob(key); // A second click or tab joins the job already underway.
  if (running) return { job: jobView(running) };
  const resolved = await src.resolve(String(id), format, hint);
  const args = { url: resolved.url, coverUrl: resolved.cover ?? meta?.cover, meta: { ...meta, ...resolved.meta }, source, sourceId: String(id) };
  if (!resolved.build) return lib.addFromUrl(args);
  return { job: jobView(startJob(key, (progress) => lib.addFromUrl({ ...args, build: resolved.build, progress }))) };
});

route('GET', '/api/jobs/([\\w-]+)', ({ params }) => {
  const job = jobs.get(params[0]);
  if (!job) throw new HttpError(404, 'O download foi interrompido (o servidor foi reiniciado?)');
  return jobView(job);
});

route('POST', '/api/library/import', async ({ req }) => {
  const name = decodeURIComponent(req.headers['x-filename'] ?? 'livro');
  return lib.addFromUpload(req, name);
});

const bookOr404 = (id) => {
  const b = lib.find(id);
  if (!b) throw new HttpError(404, 'Livro não encontrado');
  return b;
};

route('GET', '/api/library/([\\w-]+)/file', ({ req, res, params }) => sendFile(req, res, lib.filePath(bookOr404(params[0]))));

route('GET', '/api/library/([\\w-]+)/cover', ({ req, res, params }) => {
  const p = lib.coverPath(bookOr404(params[0]));
  if (!p) throw new HttpError(404, 'Sem capa');
  return sendFile(req, res, p, { cache: 'max-age=31536000, immutable' });
});

route('PUT', '/api/library/([\\w-]+)/cover', ({ req, params }) => {
  const type = req.headers['content-type'] ?? '';
  if (!type.startsWith('image/')) throw new HttpError(415, 'Envie uma imagem');
  return lib.setCover(params[0], req, type);
});

route('GET', '/api/library/([\\w-]+)/locations', async ({ params }) => {
  try { return JSON.parse(await readFile(lib.locationsPath(bookOr404(params[0])), 'utf8')); } catch { return null; }
});

route('PUT', '/api/library/([\\w-]+)/locations', async ({ req, params }) => {
  const data = await body(req);
  await writeFile(lib.locationsPath(bookOr404(params[0])), JSON.stringify(data));
  return { ok: true };
});

route('PATCH', '/api/library/([\\w-]+)', async ({ req, params }) => {
  const b = await lib.update(params[0], await body(req));
  if (!b) throw new HttpError(404, 'Livro não encontrado');
  return b;
});

route('DELETE', '/api/library/([\\w-]+)', async ({ params }) => ({ ok: await lib.remove(params[0]) }));

route('GET', '/api/collections', () => lib.collections());

const collectionName = (name) => {
  const n = String(name ?? '').trim().slice(0, 60);
  if (!n) throw new HttpError(400, 'Dê um nome à coleção');
  return n;
};

route('POST', '/api/collections', async ({ req }) => lib.addCollection(collectionName((await body(req)).name)));

route('PATCH', '/api/collections/([\\w-]+)', async ({ req, params }) => {
  const c = await lib.renameCollection(params[0], collectionName((await body(req)).name));
  if (!c) throw new HttpError(404, 'Coleção não encontrada');
  return c;
});

route('DELETE', '/api/collections/([\\w-]+)', async ({ params }) => {
  await lib.removeCollection(params[0]);
  return { ok: true };
});

route('GET', '/api/define', async ({ url }) => {
  const word = url.searchParams.get('word')?.trim();
  if (!word) throw new HttpError(400, 'Escolha uma palavra');
  let found;
  try {
    found = await define(word, url.searchParams.get('lang'));
  } catch (err) {
    if (err.status === 429) throw new HttpError(503, 'O dicionário está ocupado. Tente de novo em alguns segundos.');
    throw err;
  }
  if (!found) throw new HttpError(404, `“${word}” não está no dicionário`);
  return found;
});

route('GET', '/api/catalogs', () => lib.catalogs().map((c) => ({ ...c, url: hideCreds(c.url) })));

route('POST', '/api/catalogs', async ({ req }) => {
  const { name, url } = await body(req);
  let u;
  try { u = new URL(String(url).trim()); } catch { throw new HttpError(400, 'Endereço inválido'); }
  if (!/^https?:$/.test(u.protocol)) throw new HttpError(400, 'Use um endereço http ou https');
  // Validate up front so a typo shows up here, not as a failed search later.
  try { await searchTemplate(u.toString()); } catch (err) { throw new HttpError(422, `Não consegui usar este catálogo: ${err.message}`); }
  const cat = await lib.addCatalog({ name: String(name || u.host).slice(0, 60), url: u.toString() });
  return { ...cat, url: hideCreds(cat.url) };
});

route('DELETE', '/api/catalogs/([\\w-]+)', async ({ params }) => {
  await lib.removeCatalog(params[0]);
  return { ok: true };
});

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) {
      // Block other websites from driving the local API (CSRF / download abuse).
      const origin = req.headers.origin;
      if (req.method !== 'GET' && origin && origin !== `http://${req.headers.host}`) throw new HttpError(403, 'Origem não permitida');
      for (const r of routes) {
        const m = r.method === req.method && url.pathname.match(r.pattern);
        if (!m) continue;
        const out = await r.handler({ req, res, url, params: m.slice(1) });
        if (!res.headersSent && out !== undefined) send(res, 200, out);
        return;
      }
      throw new HttpError(404, 'Rota não encontrada');
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Método não permitido');
    await serveStatic(req, res, url.pathname);
  } catch (err) {
    const status = err.status ?? 502;
    if (status >= 500) console.error(`[${req.method} ${url.pathname}]`, err.message);
    if (!res.headersSent) send(res, status, { error: err.name === 'TimeoutError' ? 'A fonte demorou demais para responder' : err.message });
    else res.end();
  }
});

// Resolves with the port actually bound, so the desktop app can ask for port 0 (any free one).
export function start({ port = PORT, host = HOST } = {}) {
  return new Promise((resolve, reject) => {
    const fail = (err) => { server.off('listening', ok); reject(err); };
    const ok = () => { server.off('error', fail); resolve(server.address().port); };
    server.once('error', fail).once('listening', ok).listen(port, host);
  });
}

export function stop() {
  server.close();
  server.closeAllConnections(); // don't wait for keep-alive sockets or a PDF mid-stream
}

// `npm start` / `node server/index.js` listen right away; the desktop app imports start() instead.
const runDirectly = (() => {
  try { return realpathSync(process.argv[1]) === import.meta.filename; } catch { return false; }
})();

if (runDirectly) {
  start().then((port) => {
    const shown = HOST === '0.0.0.0' ? 'localhost' : HOST;
    console.log(`\n  📚 Estante rodando em http://${shown}:${port}\n     Biblioteca em ${lib.DATA}\n`);
  });
}
