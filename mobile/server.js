// The Estante API inside the iOS app, where there is no server: the routes of server/index.js,
// answered in the page (public/js/api.js sends its requests here). Sources and the dictionary
// are the server's own modules, bundled by mobile/build.mjs; the library lives in the app
// (library.js), and the sources the user adds run apart from everything else (sandbox.js).
// Library Genesis isn't built in here: it can be added back as one of those (dist/fontes/).
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import builtin from '../server/sources/builtin.js';
import { makeCatalogSource, searchTemplate } from '../server/sources/opds.js';
import { getText } from '../server/http.js';
import { define } from '../server/dictionary.js';
import * as lib from './library.js';
import * as sandbox from './sandbox.js';
import { randomUUID } from './crypto.js';

// Capacitor's XMLHttpRequest patch (CapacitorHttp) swaps the class for a function that sets up
// each request, and pdf.js, which loads the app's own files with XMLHttpRequest, trips on two
// gaps in it: the URL has to be a string (pdf.js passes a URL object), and the readyState
// constants (XMLHttpRequest.DONE) are gone.
const CapacitorXHR = window.XMLHttpRequest;
window.XMLHttpRequest = function XMLHttpRequest() {
  const req = new CapacitorXHR();
  const open = req.open; // the patch puts its open() back on the prototype each time
  req.open = (method, url, ...rest) => open.call(req, method, url instanceof URL ? url.href : url, ...rest);
  return req;
};
window.XMLHttpRequest.prototype = Object.getPrototypeOf(new CapacitorXHR());
Object.assign(window.XMLHttpRequest, { UNSENT: 0, OPENED: 1, HEADERS_RECEIVED: 2, LOADING: 3, DONE: 4 });

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// --- sources the user added ---
const sandboxes = new Map(); // id -> sandbox, started on first use

function started(s) {
  if (!sandboxes.has(s.id)) {
    const open = lib.externalCode(s.id).then(sandbox.open);
    open.catch(() => sandboxes.delete(s.id)); // try again next time
    sandboxes.set(s.id, open);
  }
  return sandboxes.get(s.id);
}

function stop(id) {
  sandboxes.get(id)?.then((s) => s.close(), () => {});
  sandboxes.delete(id);
}

const text = (v, max) => (v == null || typeof v === 'object' ? null : String(v).slice(0, max) || null);
const webUrl = (v) => {
  try {
    const u = new URL(v);
    return /^https?:$/.test(u.protocol) ? u.toString() : null;
  } catch { return null; }
};

// What a source sends back is checked like any input: the fields the shelf shows, in their shapes.
function cleanResult(r) {
  const id = text(r?.id, 500);
  const formats = Array.isArray(r?.formats) ? [...new Set(r.formats.filter((f) => f === 'epub' || f === 'pdf'))] : [];
  if (!id || !formats.length) return null;
  return {
    id,
    title: text(r.title, 300) ?? 'Sem título',
    authors: Array.isArray(r.authors) ? r.authors.map((a) => text(a, 120)).filter(Boolean).slice(0, 5) : [],
    year: text(r.year, 10),
    language: text(r.language, 10),
    description: text(r.description, 400),
    cover: r.cover ? webUrl(r.cover) : null,
    formats,
  };
}

const external = (s) => ({
  id: `ext:${s.id}`,
  name: s.name,
  description: `Fonte externa${s.description ? ` · ${s.description}` : ''}`,
  kind: 'external',
  optIn: s.optIn,
  async search(q, page) {
    const out = await (await started(s)).call('search', q, page);
    return { results: (Array.isArray(out?.results) ? out.results : []).map(cleanResult).filter(Boolean), hasMore: !!out?.hasMore };
  },
  async resolve(id, format) {
    const url = webUrl((await (await started(s)).call('resolve', id, format))?.url);
    if (!url) throw new Error('A fonte não devolveu um link de download');
    return { url };
  },
});

function sources() {
  return [
    ...builtin.map((s) => ({ ...s, kind: 'builtin' })),
    ...lib.externals().map(external),
    ...lib.catalogs().map(makeCatalogSource),
  ];
}

const sourceView = ({ id, name, description, kind, optIn = false }) => ({ id, name, description, kind, optIn });

// From a link or from a file's text. The code is tried in a sandbox before it is kept.
async function addSource({ url, code } = {}) {
  let from = null;
  if (url) {
    let u;
    try { u = new URL(String(url).trim()); } catch { throw new HttpError(400, 'Endereço inválido'); }
    if (!/^https?:$/.test(u.protocol)) throw new HttpError(400, 'Use um endereço http ou https');
    from = u.toString();
    code = await getText(from, { timeout: 20000 });
  }
  if (typeof code !== 'string' || !code.trim()) throw new HttpError(400, 'Escolha um arquivo .js com a fonte');
  if (code.length > 2e6) throw new HttpError(413, 'Arquivo grande demais para uma fonte');
  let info;
  try {
    const s = await sandbox.open(code);
    info = s.info;
    s.close();
  } catch (err) {
    throw new HttpError(422, `Não consegui usar esta fonte: ${err.message}`);
  }
  const { id, name, description, optIn } = info;
  if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(id)) {
    throw new HttpError(422, 'A fonte precisa de um id feito de letras minúsculas, números e hífens');
  }
  if (typeof name !== 'string' || !name.trim()) throw new HttpError(422, 'A fonte precisa de um nome');
  stop(id); // an older version of the same source
  const saved = await lib.addExternal({
    id,
    name: name.trim().slice(0, 60),
    description: typeof description === 'string' ? description.trim().slice(0, 200) : '',
    optIn: optIn === true,
    from,
  }, code);
  return sourceView(external(saved));
}

// --- routes, as in server/index.js ---
const routes = [];
const route = (method, pattern, handler) => routes.push({ method, pattern: new RegExp(`^${pattern}$`), handler });

route('GET', '/api/sources', () => sources().map(sourceView));

route('POST', '/api/sources', ({ body }) => addSource(body));

route('DELETE', '/api/sources/([\\w-]+)', async ({ params }) => {
  stop(params[0]);
  await lib.removeExternal(params[0]);
  return { ok: true };
});

route('GET', '/api/search', async ({ url }) => {
  const q = url.searchParams.get('q')?.trim();
  const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
  const src = sources().find((s) => s.id === url.searchParams.get('source'));
  if (!q) throw new HttpError(400, 'Digite algo para buscar');
  if (!src) throw new HttpError(404, 'Fonte desconhecida');
  const { results, hasMore } = await src.search(q, page);
  for (const r of results) {
    r.source = src.id;
    r.inLibrary = r.formats.map((f) => lib.findBySource(src.id, r.id, f)?.id).filter(Boolean)[0] ?? null;
  }
  return { results, hasMore };
});

route('GET', '/api/library', () => lib.list());

// Books assembled chapter by chapter take minutes, so they run as jobs the shelf polls.
// iOS pauses the app in the background, and the job with it, until it comes back.
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
    .finally(() => setTimeout(() => jobs.delete(job.id), 10 * 60 * 1000));
  return job;
}

route('POST', '/api/library', async ({ body }) => {
  const { source, id, format, url: hint, meta } = body ?? {};
  const src = sources().find((s) => s.id === source);
  if (!src) throw new HttpError(404, 'Fonte desconhecida');
  if (!['epub', 'pdf', 'auto'].includes(format)) throw new HttpError(400, 'Formato inválido');
  const existing = lib.findBySource(source, id, format);
  if (existing) return existing;
  const key = `${source}:${id}:${format}`;
  const running = runningJob(key);
  if (running) return { job: jobView(running) };
  const resolved = await src.resolve(String(id), format, hint);
  const args = { url: resolved.url, coverUrl: resolved.cover ?? meta?.cover, meta: { ...meta, ...resolved.meta }, source, sourceId: String(id) };
  if (!resolved.build) return lib.addFromUrl(args);
  return { job: jobView(startJob(key, (progress) => lib.addFromUrl({ ...args, build: resolved.build, progress }))) };
});

route('GET', '/api/jobs/([\\w-]+)', ({ params }) => {
  const job = jobs.get(params[0]);
  if (!job) throw new HttpError(404, 'O download foi interrompido (o app foi fechado?)');
  return jobView(job);
});

route('POST', '/api/library/import', ({ body, headers }) => {
  if (!(body instanceof Blob)) throw new HttpError(400, 'Escolha um arquivo');
  return lib.addFromUpload(body, decodeURIComponent(headers['X-Filename'] ?? 'livro'));
});

const bookOr404 = (id) => {
  const b = lib.find(id);
  if (!b) throw new HttpError(404, 'Livro não encontrado');
  return b;
};

route('PUT', '/api/library/([\\w-]+)/cover', ({ body, headers, params }) => {
  const type = headers['Content-Type'] ?? '';
  if (!(body instanceof Blob) || !type.startsWith('image/')) throw new HttpError(415, 'Envie uma imagem');
  return lib.setCover(params[0], body, type);
});

route('GET', '/api/library/([\\w-]+)/locations', ({ params }) => lib.locations(bookOr404(params[0])));

route('PUT', '/api/library/([\\w-]+)/locations', async ({ body, params }) => {
  await lib.saveLocations(bookOr404(params[0]), body);
  return { ok: true };
});

route('PATCH', '/api/library/([\\w-]+)', async ({ body, params }) => {
  const b = await lib.update(params[0], body ?? {});
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

route('POST', '/api/collections', ({ body }) => lib.addCollection(collectionName(body?.name)));

route('PATCH', '/api/collections/([\\w-]+)', async ({ body, params }) => {
  const c = await lib.renameCollection(params[0], collectionName(body?.name));
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

const hideCreds = (url) => {
  const u = new URL(url);
  if (u.password) u.password = '•••';
  return u.toString();
};

route('GET', '/api/catalogs', () => lib.catalogs().map((c) => ({ ...c, url: hideCreds(c.url) })));

route('POST', '/api/catalogs', async ({ body }) => {
  const { name, url } = body ?? {};
  let u;
  try { u = new URL(String(url).trim()); } catch { throw new HttpError(400, 'Endereço inválido'); }
  if (!/^https?:$/.test(u.protocol)) throw new HttpError(400, 'Use um endereço http ou https');
  try { await searchTemplate(u.toString()); } catch (err) { throw new HttpError(422, `Não consegui usar este catálogo: ${err.message}`); }
  const cat = await lib.addCatalog({ name: String(name || u.host).slice(0, 60), url: u.toString() });
  return { ...cat, url: hideCreds(cat.url) };
});

route('DELETE', '/api/catalogs/([\\w-]+)', async ({ params }) => {
  await lib.removeCatalog(params[0]);
  return { ok: true };
});

function abortable(promise, signal) {
  if (!signal) return promise;
  const aborted = () => new DOMException('A busca foi cancelada', 'AbortError');
  if (signal.aborted) return Promise.reject(aborted());
  return new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(aborted()), { once: true });
    promise.then(resolve, reject);
  });
}

// What fetch() would have done with the server: the answer as a copy (so the page can't change
// the library by changing what it got), or an Error with the status and message.
export async function request(method, path, body, headers = {}, signal) {
  const url = new URL(path, 'http://estante');
  for (const r of routes) {
    const m = r.method === method && url.pathname.match(r.pattern);
    if (!m) continue;
    try {
      const out = await abortable(r.handler({ url, body, headers, params: m.slice(1) }), signal);
      return out == null ? null : JSON.parse(JSON.stringify(out));
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      const status = err.status ?? 502;
      if (status >= 500) console.error(`[${method} ${url.pathname}]`, err.message);
      const message = err.name === 'TimeoutError' ? 'A fonte demorou demais para responder' : err.message;
      throw Object.assign(new Error(message), { status });
    }
  }
  throw Object.assign(new Error('Rota não encontrada'), { status: 404 });
}

export const { fileUrl, coverUrl } = lib;

// A file the page made (the notes in Markdown) goes out through the system's share sheet:
// Save to Files, AirDrop, Notes, Mail…
export async function shareText(name, data) {
  const { uri } = await Filesystem.writeFile({ directory: Directory.Cache, path: name, data, encoding: Encoding.UTF8 });
  try {
    await Share.share({ files: [uri] });
  } catch (err) {
    if (!/cancel/i.test(err.message)) throw err;
  }
}
