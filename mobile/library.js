// The library inside the iOS app: the same files as server/library.js (library.json,
// settings.json, books/, covers/, locations/) in a "data" folder in the app's Documents, which
// the Files app shows under On My iPhone › Estante. Books are downloaded straight to disk
// (@capacitor/file-transfer), and the reader opens them through the app's file URLs.
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { FileTransfer } from '@capacitor/file-transfer';
import { get, prepare, httpError } from '../server/http.js';
import { newBook, applyPatch } from '../server/records.js';
import { randomUUID } from './crypto.js';

const DIR = Directory.Documents;
const MAX_BYTES = 500 * 1024 * 1024;
const CHUNK = 3 * 1024 * 1024; // a multiple of 3, so the base64 pieces add up to the whole file

// Only the missing ones: the plugin logs an error for each folder that already exists.
const have = await Filesystem.readdir({ directory: DIR, path: 'data' }).then((r) => r.files.map((f) => f.name), () => []);
await Promise.all(['books', 'covers', 'locations', 'sources'].filter((d) => !have.includes(d)).map((d) =>
  Filesystem.mkdir({ directory: DIR, path: `data/${d}`, recursive: true }).catch(() => {})));
const ROOT = (await Filesystem.getUri({ directory: DIR, path: 'data' })).uri.replace(/\/$/, '');

const path = (...parts) => ['data', ...parts].join('/'); // for @capacitor/filesystem
const uri = (...parts) => [ROOT, ...parts].join('/'); // the same file as a file:// URL
const webUrl = (...parts) => Capacitor.convertFileSrc(uri(...parts)); // ...and as the page loads it

async function readJSON(p, fallback) {
  try { return JSON.parse((await Filesystem.readFile({ directory: DIR, path: p, encoding: Encoding.UTF8 })).data); } catch { return fallback; }
}
const writeText = (p, data) => Filesystem.writeFile({ directory: DIR, path: p, data, encoding: Encoding.UTF8 });
const del = (p) => Filesystem.deleteFile({ directory: DIR, path: p }).catch(() => {});

async function move(from, to) {
  try {
    await Filesystem.rename({ directory: DIR, from, to });
  } catch {
    await del(to); // in case a rename won't replace an existing file
    await Filesystem.rename({ directory: DIR, from, to });
  }
}

// Writes go through a single queue and a temp file so a crash never leaves half a JSON.
let queue = Promise.resolve();
function writeJSON(p, value) {
  const run = queue.then(async () => {
    await writeText(`${p}.tmp`, JSON.stringify(value, null, 2));
    await move(`${p}.tmp`, p);
  });
  queue = run.catch(() => {});
  return run;
}

let books = await readJSON(path('library.json'), []);
const settings = await readJSON(path('settings.json'), {});
settings.catalogs ??= [];
settings.collections ??= [];
settings.sources ??= [];
const save = () => writeJSON(path('library.json'), books);
const saveSettings = () => writeJSON(path('settings.json'), settings);

export const list = () => [...books].sort((a, b) => (b.lastOpenedAt ?? b.addedAt).localeCompare(a.lastOpenedAt ?? a.addedAt));
export const find = (id) => books.find((b) => b.id === id);
export const findBySource = (source, sourceId, format) =>
  books.find((b) => b.source === source && b.sourceId === sourceId && (!format || format === 'auto' || b.format === format));

export const fileUrl = (b) => webUrl('books', b.file);
export const coverUrl = (b) => (b.cover ? webUrl('covers', b.cover) : null);

// The bridge to the native side carries files as base64, a piece at a time.
const base64 = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result.slice(r.result.indexOf(',') + 1));
  r.onerror = () => reject(r.error);
  r.readAsDataURL(blob);
});

async function writeBlob(p, blob) {
  if (blob.size > MAX_BYTES) throw new Error('Arquivo grande demais (limite de 500 MB)');
  for (let i = 0; i === 0 || i < blob.size; i += CHUNK) {
    const data = await base64(blob.slice(i, i + CHUNK));
    await (i === 0 ? Filesystem.writeFile : Filesystem.appendFile)({ directory: DIR, path: p, data });
  }
}

async function sniff(...parts) {
  const res = await fetch(webUrl(...parts), { headers: { Range: 'bytes=0-7' } });
  const head = String.fromCharCode(...new Uint8Array(await res.arrayBuffer()).subarray(0, 8));
  if (head.startsWith('PK\x03\x04')) return 'epub';
  if (head.startsWith('%PDF-')) return 'pdf';
  return null;
}

// books/<id>.part, downloaded or written, becomes a book once its size and magic bytes check
// out, so an HTML error page or a login form never ends up in the library disguised as a book.
async function store(id, write) {
  const part = path('books', `${id}.part`);
  try {
    await write(part);
    const { size } = await Filesystem.stat({ directory: DIR, path: part });
    if (size > MAX_BYTES) throw new Error('Arquivo grande demais (limite de 500 MB)');
    const format = await sniff('books', `${id}.part`);
    if (!format) throw new Error('O arquivo recebido não é um EPUB nem um PDF');
    const file = `${id}.${format}`;
    await move(part, path('books', file));
    return { file, format, size };
  } catch (err) {
    await del(part);
    throw err;
  }
}

async function download(url, id) {
  const req = prepare(url);
  try {
    await FileTransfer.downloadFile({ url: req.url, path: uri('books', `${id}.part`), headers: req.headers, connectTimeout: 120000, readTimeout: 120000 });
  } catch (err) {
    const status = err.data?.httpStatus ?? err.httpStatus;
    throw status ? httpError(status, req.url) : new Error(`Não consegui baixar o arquivo (${err.message})`);
  }
}

const imageExt = (type) => (type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : 'jpg');

async function storeCover(url, id) {
  if (!url) return null;
  try {
    const res = await get(url, { timeout: 10000 });
    const type = res.headers.get('content-type') ?? '';
    if (!type.startsWith('image/')) return null;
    const name = `${id}.${imageExt(type)}`;
    await writeBlob(path('covers', name), await res.blob());
    return name;
  } catch {
    return null; // A missing cover is not worth failing the download for.
  }
}

async function addRecord(fields) {
  const book = newBook(fields);
  books.push(book);
  await save();
  return book;
}

// `build` is for books a source assembles itself (chapters -> EPUB).
export async function addFromUrl({ url, build, progress = () => {}, coverUrl: cover, meta, source, sourceId }) {
  const id = randomUUID();
  const stored = await store(id, async (part) => {
    if (build) await writeBlob(part, new Blob([await build(progress)]));
    else await download(url, id);
  });
  return addRecord({ id, ...stored, cover: await storeCover(cover, id), meta, source, sourceId });
}

export async function addFromUpload(file, filename) {
  const id = randomUUID();
  const stored = await store(id, (part) => writeBlob(part, file));
  const title = String(filename || 'Sem título').replace(/^.*[\\/]/, '').replace(/\.(epub|pdf)$/i, '').replace(/[_]+/g, ' ').trim();
  return addRecord({ id, ...stored, cover: null, meta: { title }, source: 'local', sourceId: null });
}

export async function update(id, patch) {
  const b = find(id);
  if (!b) return null;
  applyPatch(b, patch, settings.collections);
  await save();
  return b;
}

export async function setCover(id, blob, type) {
  const b = find(id);
  if (!b) return null;
  if (blob.size > 5 * 1024 * 1024) throw new Error('Capa grande demais');
  // A new name each time, as on the server.
  const name = `${id}-${Date.now().toString(36)}.${imageExt(type)}`;
  const old = b.cover;
  await writeBlob(path('covers', name), blob);
  b.cover = name;
  await save();
  if (old && old !== name) await del(path('covers', old));
  return b;
}

export async function remove(id) {
  const b = find(id);
  if (!b) return false;
  books = books.filter((x) => x !== b);
  await save();
  await Promise.all([
    del(path('books', b.file)),
    b.cover && del(path('covers', b.cover)),
    del(path('locations', `${b.id}.json`)),
  ]);
  return true;
}

export const locations = (b) => readJSON(path('locations', `${b.id}.json`), null);
export const saveLocations = (b, data) => writeText(path('locations', `${b.id}.json`), JSON.stringify(data));

// --- collections (shelves the user names; books list the ones they are in) ---
export const collections = () => settings.collections;
export async function addCollection(name) {
  const same = settings.collections.find((c) => c.name.toLocaleLowerCase() === name.toLocaleLowerCase());
  if (same) return same;
  const c = { id: randomUUID().slice(0, 8), name };
  settings.collections.push(c);
  await saveSettings();
  return c;
}
export async function renameCollection(id, name) {
  const c = settings.collections.find((x) => x.id === id);
  if (!c) return null;
  c.name = name;
  await saveSettings();
  return c;
}
export async function removeCollection(id) {
  settings.collections = settings.collections.filter((c) => c.id !== id);
  for (const b of books) if (b.collections?.includes(id)) b.collections = b.collections.filter((c) => c !== id);
  await Promise.all([saveSettings(), save()]);
}

// --- custom OPDS catalogs ---
export const catalogs = () => settings.catalogs;
export async function addCatalog({ name, url }) {
  const cat = { id: randomUUID().slice(0, 8), name, url };
  settings.catalogs.push(cat);
  await saveSettings();
  return cat;
}
export async function removeCatalog(id) {
  settings.catalogs = settings.catalogs.filter((c) => c.id !== id);
  await saveSettings();
}

// --- sources the user added (Fontes › Adicionar fonte); their code is in sources/<id>.js ---
export const externals = () => settings.sources;
export const externalCode = async (id) =>
  (await Filesystem.readFile({ directory: DIR, path: path('sources', `${id}.js`), encoding: Encoding.UTF8 })).data;
export async function addExternal(info, code) {
  await writeText(path('sources', `${info.id}.js`), code);
  settings.sources = [...settings.sources.filter((s) => s.id !== info.id), info];
  await saveSettings();
  return info;
}
export async function removeExternal(id) {
  settings.sources = settings.sources.filter((s) => s.id !== id);
  await saveSettings();
  await del(path('sources', `${id}.js`));
}
