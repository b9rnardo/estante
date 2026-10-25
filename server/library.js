// On-disk library: data/library.json plus one file per book under data/books.
import { mkdir, readFile, writeFile, rename, rm, open, stat } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { get } from './http.js';
import { newBook, applyPatch } from './records.js';

export const DATA = path.resolve(process.env.ESTANTE_DATA ?? path.join(import.meta.dirname, '..', 'data'));
export const DIRS = {
  books: path.join(DATA, 'books'),
  covers: path.join(DATA, 'covers'),
  locations: path.join(DATA, 'locations'),
};
const LIB = path.join(DATA, 'library.json');
const SETTINGS = path.join(DATA, 'settings.json');
const MAX_BYTES = 500 * 1024 * 1024;

await Promise.all(Object.values(DIRS).map((d) => mkdir(d, { recursive: true })));

async function readJSON(file, fallback) {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch { return fallback; }
}

// Writes go through a single queue and a temp file so a crash never leaves half a JSON.
let queue = Promise.resolve();
function writeJSON(file, value) {
  queue = queue.then(async () => {
    const tmp = `${file}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(value, null, 2));
    await rename(tmp, file);
  });
  return queue;
}

let books = await readJSON(LIB, []);
let settings = await readJSON(SETTINGS, {});
settings.catalogs ??= [];
settings.collections ??= [];
const save = () => writeJSON(LIB, books);

export const list = () => [...books].sort((a, b) => (b.lastOpenedAt ?? b.addedAt).localeCompare(a.lastOpenedAt ?? a.addedAt));
export const find = (id) => books.find((b) => b.id === id);
export const findBySource = (source, sourceId, format) =>
  books.find((b) => b.source === source && b.sourceId === sourceId && (!format || format === 'auto' || b.format === format));

export const filePath = (b) => path.join(DIRS.books, b.file);
export const coverPath = (b) => (b.cover ? path.join(DIRS.covers, b.cover) : null);
export const locationsPath = (b) => path.join(DIRS.locations, `${b.id}.json`);

async function sniff(file) {
  const fh = await open(file, 'r');
  try {
    const { buffer } = await fh.read(Buffer.alloc(8), 0, 8, 0);
    if (buffer.subarray(0, 4).toString('latin1') === 'PK\x03\x04') return 'epub';
    if (buffer.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
    return null;
  } finally {
    await fh.close();
  }
}

// Streams a body into data/books, then checks the magic bytes so an HTML error
// page or a login form never ends up in the library disguised as a book.
async function storeStream(stream, id) {
  const tmp = path.join(DIRS.books, `${id}.part`);
  let bytes = 0;
  const limit = async function* (source) {
    for await (const chunk of source) {
      bytes += chunk.length;
      if (bytes > MAX_BYTES) throw new Error('Arquivo grande demais (limite de 500 MB)');
      yield chunk;
    }
  };
  try {
    await pipeline(stream, limit, createWriteStream(tmp));
    const format = await sniff(tmp);
    if (!format) throw new Error('O arquivo recebido não é um EPUB nem um PDF');
    const file = `${id}.${format}`;
    await rename(tmp, path.join(DIRS.books, file));
    return { file, format, size: bytes };
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}

async function storeCover(url, id) {
  if (!url) return null;
  try {
    const res = await get(url, { timeout: 10000 });
    const type = res.headers.get('content-type') ?? '';
    if (!type.startsWith('image/')) return null;
    const ext = type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : 'jpg';
    const name = `${id}.${ext}`;
    await writeFile(path.join(DIRS.covers, name), Buffer.from(await res.arrayBuffer()));
    return name;
  } catch {
    return null; // A missing cover is not worth failing the download for.
  }
}

// `build` is for books a source assembles itself (chapters -> EPUB); the result
// still goes through the same size and magic-byte checks as a download.
export async function addFromUrl({ url, build, progress = () => {}, coverUrl, meta, source, sourceId }) {
  const id = randomUUID();
  const body = build ? Readable.from([await build(progress)]) : Readable.fromWeb((await get(url, { timeout: 120000 })).body);
  const stored = await storeStream(body, id);
  const cover = await storeCover(coverUrl, id);
  return addRecord({ id, ...stored, cover, meta, source, sourceId });
}

export async function addFromUpload(req, filename) {
  const id = randomUUID();
  const stored = await storeStream(req, id);
  const title = path.basename(filename || 'Sem título').replace(/\.(epub|pdf)$/i, '').replace(/[_]+/g, ' ').trim();
  return addRecord({ id, ...stored, cover: null, meta: { title }, source: 'local', sourceId: null });
}

async function addRecord(fields) {
  const book = newBook(fields);
  books.push(book);
  await save();
  return book;
}

export async function update(id, patch) {
  const b = find(id);
  if (!b) return null;
  applyPatch(b, patch, settings.collections);
  await save();
  return b;
}

export async function setCover(id, req, type) {
  const b = find(id);
  if (!b) return null;
  const ext = type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : 'jpg';
  // A new name each time: the cover URL is versioned by it and cached as immutable.
  const name = `${id}-${Date.now().toString(36)}.${ext}`;
  const old = b.cover;
  const chunks = [];
  let n = 0;
  for await (const c of req) {
    n += c.length;
    if (n > 5 * 1024 * 1024) throw new Error('Capa grande demais');
    chunks.push(c);
  }
  await writeFile(path.join(DIRS.covers, name), Buffer.concat(chunks));
  b.cover = name;
  await save();
  if (old && old !== name) await rm(path.join(DIRS.covers, old), { force: true });
  return b;
}

export async function remove(id) {
  const b = find(id);
  if (!b) return false;
  books = books.filter((x) => x !== b);
  await save();
  await Promise.all([
    rm(filePath(b), { force: true }),
    b.cover && rm(path.join(DIRS.covers, b.cover), { force: true }),
    rm(locationsPath(b), { force: true }),
  ]);
  return true;
}

export const exists = async (p) => !!(await stat(p).catch(() => null));

// --- collections (shelves the user names; books list the ones they are in) ---
export const collections = () => settings.collections;
export async function addCollection(name) {
  const same = settings.collections.find((c) => c.name.toLocaleLowerCase() === name.toLocaleLowerCase());
  if (same) return same;
  const c = { id: randomUUID().slice(0, 8), name };
  settings.collections.push(c);
  await writeJSON(SETTINGS, settings);
  return c;
}
export async function renameCollection(id, name) {
  const c = settings.collections.find((x) => x.id === id);
  if (!c) return null;
  c.name = name;
  await writeJSON(SETTINGS, settings);
  return c;
}
export async function removeCollection(id) {
  settings.collections = settings.collections.filter((c) => c.id !== id);
  for (const b of books) if (b.collections?.includes(id)) b.collections = b.collections.filter((c) => c !== id);
  await Promise.all([writeJSON(SETTINGS, settings), save()]);
}

// --- settings (custom OPDS catalogs) ---
export const catalogs = () => settings.catalogs;
export async function addCatalog({ name, url }) {
  const cat = { id: randomUUID().slice(0, 8), name, url };
  settings.catalogs.push(cat);
  await writeJSON(SETTINGS, settings);
  return cat;
}
export async function removeCatalog(id) {
  settings.catalogs = settings.catalogs.filter((c) => c.id !== id);
  await writeJSON(SETTINGS, settings);
}
