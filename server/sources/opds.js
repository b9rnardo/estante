// Generic OPDS 1.x (Atom) client. Works with Calibre, Calibre-Web, Kavita, Komga,
// COPS and most public catalogs that expose an OpenSearch "search" link.
import { XMLParser } from 'fast-xml-parser';
import { getText, stripHtml } from '../http.js';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  removeNSPrefix: true,
  isArray: (name) => ['entry', 'link', 'author', 'Url'].includes(name),
});

const ACQ = 'http://opds-spec.org/acquisition';
const MIME = { 'application/epub+zip': 'epub', 'application/pdf': 'pdf' };

const text = (v) => (v == null ? '' : typeof v === 'object' ? String(v['#text'] ?? '') : String(v));
const abs = (href, base) => {
  try { return new URL(href, base).toString(); } catch { return null; }
};

export async function fetchFeed(url) {
  const xml = await getText(url, { headers: { Accept: 'application/atom+xml, application/xml;q=0.9, */*;q=0.5' } });
  const doc = parser.parse(xml);
  if (!doc.feed && !doc.entry) throw new Error('A resposta não parece um catálogo OPDS');
  return doc.feed ?? { entry: [doc.entry].flat() };
}

// Turns one Atom <entry> into our result shape. Entries that only point at another
// feed (common in search results, e.g. Gutenberg) are kept as "lazy" results whose
// acquisition links are fetched when the user downloads.
export function parseEntry(entry, base) {
  const links = entry.link ?? [];
  const downloads = {};
  let cover = null;
  let thumb = null;
  let detail = null;

  for (const l of links) {
    const rel = l.rel ?? '';
    const type = (l.type ?? '').split(';')[0].trim();
    const href = abs(l.href, base);
    if (!href) continue;
    // Plain acquisition and open-access only; buy/borrow/subscribe need a storefront.
    const isAcq = rel === ACQ || rel === `${ACQ}/open-access` || rel === `${ACQ}/generic`;
    if (isAcq && MIME[type] && !downloads[MIME[type]]) downloads[MIME[type]] = href;
    else if (rel === 'http://opds-spec.org/image/thumbnail' || rel === 'x-stanza-cover-image-thumbnail') thumb = href;
    else if (rel === 'http://opds-spec.org/image' || rel === 'x-stanza-cover-image') cover = href;
    else if (type === 'application/atom+xml' && /subsection|alternate|related/.test(rel) && /entry|acquisition|opds-catalog/.test(l.type ?? '')) detail ??= href;
  }

  const formats = Object.keys(downloads);
  if (!formats.length && !detail) return null;

  const pic = cover ?? thumb;
  const authors = (entry.author ?? []).map((a) => text(a.name)).filter(Boolean);
  const issued = text(entry.issued ?? entry.date ?? entry.published);
  return {
    id: detail ?? formats.map((f) => downloads[f])[0],
    title: stripHtml(text(entry.title)) || 'Sem título',
    authors: authors.length ? authors : [stripHtml(text(entry.content))].filter((s) => s && s.length < 80),
    year: issued.match(/\d{4}/)?.[0] ?? null,
    language: text(entry.language) || null,
    description: stripHtml(text(entry.summary ?? (formats.length ? entry.content : ''))).slice(0, 400) || null,
    cover: pic && !pic.startsWith('data:') ? pic : null,
    formats: formats.length ? formats : ['auto'],
    downloads: formats.length ? downloads : null,
  };
}

// Finds the search URL template, following an OpenSearch description if needed.
const templateCache = new Map();
export async function searchTemplate(rootUrl) {
  if (templateCache.has(rootUrl)) return templateCache.get(rootUrl);
  const feed = await fetchFeed(rootUrl);
  const link = (feed.link ?? []).find((l) => l.rel === 'search');
  if (!link) throw new Error('Este catálogo não oferece busca');
  let template;
  if ((link.type ?? '').includes('opensearchdescription')) {
    const osdUrl = abs(link.href, rootUrl);
    const osd = parser.parse(await getText(osdUrl));
    const urls = osd.OpenSearchDescription?.Url ?? [];
    const u = urls.find((x) => (x.type ?? '').includes('atom')) ?? urls[0];
    if (!u?.template) throw new Error('Descrição OpenSearch sem modelo de busca');
    template = abs(u.template, osdUrl);
  } else {
    template = abs(link.href, rootUrl);
  }
  templateCache.set(rootUrl, template);
  return template;
}

export async function feedResults(url) {
  const feed = await fetchFeed(url);
  const next = (feed.link ?? []).find((l) => l.rel === 'next');
  return {
    results: (feed.entry ?? []).map((e) => parseEntry(e, url)).filter(Boolean),
    next: next ? abs(next.href, url) : null,
  };
}

// Most catalogs page through rel="next" links rather than template parameters,
// so remember where page N+1 lives after serving page N.
const nextPages = new Map();
const pageKey = (root, q, page) => `${root}\n${q}\n${page}`;

export async function search(rootUrl, q, page = 1, perPage = 25) {
  const template = await searchTemplate(rootUrl);
  const paged = /startPage|startIndex/i.test(template);
  let url = page > 1 && !paged ? nextPages.get(pageKey(rootUrl, q, page)) : null;
  if (page > 1 && !paged && !url) return { results: [], hasMore: false };
  // {searchTerms} may have been percent-encoded by URL normalisation.
  url ??= template
    .replace(/\{searchTerms\??\}|%7BsearchTerms%7D/gi, encodeURIComponent(q))
    .replace(/\{startPage\??\}|%7BstartPage%7D/gi, String(page))
    .replace(/\{startIndex\??\}|%7BstartIndex%7D/gi, String((page - 1) * perPage))
    .replace(/\{count\??\}|%7Bcount%7D/gi, String(perPage))
    .replace(/\{[^}]+\?\}|%7B[^%]+%3F%7D/gi, '');
  const { results, next } = await feedResults(url);
  if (next) {
    if (nextPages.size > 500) nextPages.delete(nextPages.keys().next().value);
    nextPages.set(pageKey(rootUrl, q, page + 1), next);
  }
  return { results, hasMore: !!next };
}

// For lazy results: open the entry's own feed and pick the wanted format.
export async function resolveEntry(entryUrl, format) {
  const feed = await fetchFeed(entryUrl);
  for (const e of feed.entry ?? []) {
    const r = parseEntry(e, entryUrl);
    if (!r?.downloads) continue;
    const pick = format === 'auto' ? (r.downloads.epub ?? r.downloads.pdf) : r.downloads[format];
    if (pick) return { url: pick, cover: r.cover };
  }
  throw new Error('Nenhum EPUB ou PDF disponível para este item');
}

export function makeCatalogSource(cat) {
  return {
    id: `opds:${cat.id}`,
    name: cat.name,
    description: new URL(cat.url).host,
    kind: 'opds',
    search: (q, page) => search(cat.url, q, page),
    async resolve(id, format, hintUrl) {
      if (hintUrl && format !== 'auto') return { url: hintUrl };
      return resolveEntry(id, format);
    },
  };
}
