// Built-in sources: public-domain and open-access collections with free APIs.
// Each source exposes search(q, page) -> { results, hasMore } and
// resolve(id, format, hintUrl) -> { url } used at download time, or
// { build(progress) -> Buffer, meta } for books assembled chapter by chapter.
import { XMLParser } from 'fast-xml-parser';
import { getJSON, getText, stripHtml } from '../http.js';
import * as opds from './opds.js';
import syosetu from './syosetu.js';
import libgen from './libgen.js';

const LANG = { por: 'pt', eng: 'en', spa: 'es', fre: 'fr', fra: 'fr', ger: 'de', deu: 'de', ita: 'it', lat: 'la' };
const arr = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

// Catalogs write "Assis, Machado de, 1839-1908"; show "Machado de Assis".
const cleanName = (n) => {
  const s = String(n).replace(/,?\s*\(?\d{3,4}\??-(\d{3,4})?\??\)?\.?$/, '').trim();
  return /^[^,]+, [^,]+$/.test(s) ? s.split(', ').reverse().join(' ') : s;
};

const GUTENBERG_LANG = { Portuguese: 'pt', Spanish: 'es', French: 'fr', German: 'de', Italian: 'it', Latin: 'la', Dutch: 'nl', Finnish: 'fi' };

// Gutenberg's own OPDS search is much faster than the Gutendex JSON mirror.
const gutenberg = {
  id: 'gutenberg',
  name: 'Project Gutenberg',
  description: 'Mais de 75 mil livros em domínio público',
  async search(q, page = 1) {
    const url = `https://www.gutenberg.org/ebooks/search.opds/?query=${encodeURIComponent(q)}&start_index=${(page - 1) * 25 + 1}`;
    const { results, next } = await opds.feedResults(url);
    return {
      hasMore: !!next,
      results: results
        .map((r) => {
          const n = r.id.match(/\/ebooks\/(\d+)\.opds/)?.[1];
          if (!n) return null; // "Authors", "Subjects" and other navigation rows.
          const lang = r.title.match(/\s\((\w+)\)$/)?.[1];
          return {
            ...r,
            id: n,
            title: lang && GUTENBERG_LANG[lang] ? r.title.slice(0, -lang.length - 3) : r.title,
            language: GUTENBERG_LANG[lang] ?? 'en',
            authors: r.authors.map(cleanName),
            cover: `https://www.gutenberg.org/cache/epub/${n}/pg${n}.cover.medium.jpg`,
            formats: ['epub'],
            downloads: null,
          };
        })
        .filter(Boolean),
    };
  },
  async resolve(id) {
    if (!/^\d+$/.test(id)) throw new Error('ID inválido');
    return { url: `https://www.gutenberg.org/ebooks/${id}.epub3.images` };
  },
};

const PDF_FORMATS = ['Text PDF', 'Image Container PDF', 'Additional Text PDF', 'PDF'];

const archive = {
  id: 'archive',
  name: 'Internet Archive',
  description: 'Livros digitalizados de acesso livre',
  async search(q, page = 1) {
    const rows = 24;
    const term = q.replace(/[():"\\]/g, ' ').trim();
    const query = [
      `(title:(${term}) OR creator:(${term}))`,
      'mediatype:texts',
      // Lending-library items are DRM-protected; only keep freely downloadable ones.
      '-access-restricted-item:true',
      'format:(EPUB OR "Text PDF" OR "Image Container PDF")',
      '-identifier:arxiv-*',
    ].join(' AND ');
    const fields = ['identifier', 'title', 'creator', 'year', 'language', 'format', 'description'];
    const url = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(query)}${fields.map((f) => `&fl[]=${f}`).join('')}&rows=${rows}&page=${page}&output=json`;
    const data = await getJSON(url);
    const docs = data.response?.docs ?? [];
    return {
      hasMore: page * rows < (data.response?.numFound ?? 0),
      results: docs.map((d) => {
        const f = arr(d.format);
        const formats = [];
        if (f.includes('EPUB')) formats.push('epub');
        if (f.some((x) => PDF_FORMATS.includes(x))) formats.push('pdf');
        const lang = arr(d.language)[0];
        return {
          id: d.identifier,
          title: arr(d.title)[0] ?? d.identifier,
          authors: arr(d.creator).slice(0, 3).map(cleanName),
          year: d.year ? String(d.year).slice(0, 4) : null,
          language: lang ? (LANG[lang.toLowerCase()] ?? lang.slice(0, 2).toLowerCase()) : null,
          description: stripHtml(arr(d.description)[0]).slice(0, 400) || null,
          cover: `https://archive.org/services/img/${encodeURIComponent(d.identifier)}`,
          formats,
        };
      }),
    };
  },
  async resolve(id, format) {
    const meta = await getJSON(`https://archive.org/metadata/${encodeURIComponent(id)}`);
    if (meta.metadata?.['access-restricted-item'] === 'true') throw new Error('Este item é de empréstimo controlado e não pode ser baixado');
    const files = (meta.files ?? []).filter((f) => f.private !== 'true');
    const want = format === 'epub' ? ['EPUB'] : PDF_FORMATS;
    const file = want.map((w) => files.find((f) => f.format === w)).find(Boolean)
      ?? files.find((f) => f.name.toLowerCase().endsWith(`.${format}`));
    if (!file) throw new Error(`Nenhum ${format.toUpperCase()} disponível neste item`);
    const path = file.name.split('/').map(encodeURIComponent).join('/');
    return { url: `https://archive.org/download/${encodeURIComponent(id)}/${path}` };
  },
};

const standard = {
  id: 'standardebooks',
  name: 'Standard Ebooks',
  description: 'Clássicos em domínio público com edição caprichada',
  async search(q, page = 1) {
    const base = 'https://standardebooks.org';
    const html = await getText(`${base}/ebooks?query=${encodeURIComponent(q)}&page=${page}&per-page=24`);
    const blocks = html.split('<li typeof="schema:Book"').slice(1);
    return {
      hasMore: /<a[^>]+rel="next"|href="[^"]*page=\d+[^"]*"[^>]*>Next</i.test(html),
      results: blocks.map((b) => {
        const path = b.match(/about="([^"]+)"/)?.[1];
        const names = [...b.matchAll(/property="schema:name">([^<]+)</g)].map((m) => stripHtml(m[1]));
        const img = b.match(/<img src="([^"]+)"/)?.[1];
        return path && {
          id: path,
          title: names[0] ?? path,
          authors: names.slice(1),
          year: null,
          language: 'en',
          description: null,
          cover: img ? new URL(img, base).toString() : null,
          formats: ['epub'],
        };
      }).filter(Boolean),
    };
  },
  async resolve(id) {
    if (!/^\/ebooks\/[\w/-]+$/.test(id)) throw new Error('ID inválido');
    const html = await getText(`https://standardebooks.org${id}`);
    const links = [...html.matchAll(/href="([^"]+\.epub)"/g)].map((m) => m[1]);
    // Prefer the compatible epub over the kepub/"advanced" variants.
    const href = links.find((l) => !/kepub|_advanced/.test(l)) ?? links[0];
    if (!href) throw new Error('Link de download não encontrado');
    // Without ?source=download the site answers with a "thanks" HTML page.
    return { url: `${new URL(href, 'https://standardebooks.org')}?source=download` };
  },
};

const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '', isArray: (n) => ['entry', 'author', 'link'].includes(n) });

const STOP = new Set(['the', 'and', 'for', 'are', 'you', 'all', 'with', 'from', 'that', 'this', 'into', 'via', 'its', 'not', 'but', 'can', 'how', 'what', 'why', 'our', 'has', 'was']);

const arxiv = {
  id: 'arxiv',
  name: 'arXiv',
  description: 'Artigos científicos em PDF',
  async search(q, page = 1) {
    const per = 20;
    // arXiv ANDs every term and indexes no stopwords, so "all you need" would match nothing.
    const all = q.toLowerCase().replace(/[():"]/g, ' ').split(/\s+/).filter(Boolean);
    const kept = all.filter((w) => w.length > 2 && !STOP.has(w));
    const words = kept.length ? kept : all;
    const query = words.map((w) => `all:${encodeURIComponent(w)}`).join('+AND+');
    const url = `https://export.arxiv.org/api/query?search_query=${query}&start=${(page - 1) * per}&max_results=${per}`;
    const feed = xml.parse(await getText(url)).feed ?? {};
    const total = Number(feed['opensearch:totalResults']?.['#text'] ?? feed['opensearch:totalResults'] ?? 0);
    return {
      hasMore: page * per < total,
      results: (feed.entry ?? []).map((e) => ({
        id: String(e.id).replace(/^https?:\/\/arxiv\.org\/abs\//, ''),
        title: stripHtml(e.title),
        authors: (e.author ?? []).map((a) => a.name).slice(0, 4),
        year: String(e.published ?? '').slice(0, 4) || null,
        language: 'en',
        description: stripHtml(e.summary).slice(0, 400),
        cover: null,
        formats: ['pdf'],
      })),
    };
  },
  async resolve(id) {
    if (!/^[\w.\/-]+$/.test(id)) throw new Error('ID inválido');
    return { url: `https://arxiv.org/pdf/${id}` };
  },
};

// Archive of Our Own: fan fiction published by its authors, with official
// EPUB/PDF downloads on every work page.
const AO3 = 'https://archiveofourown.org';
const ao3 = {
  id: 'ao3',
  name: 'Archive of Our Own',
  description: 'Fanfics publicadas pelos próprios autores',
  async search(q, page = 1) {
    const params = new URLSearchParams({ 'work_search[query]': q, 'work_search[sort_column]': 'kudos_count', page: String(page) });
    const html = await getText(`${AO3}/works/search?${params}`, { timeout: 30000 });
    if (/Page Responding Too Slowly|Retry later/i.test(html) && !html.includes('work blurb')) {
      throw new Error('O AO3 está sobrecarregado agora; tente de novo em instantes');
    }
    const blocks = html.split(/<li id="work_(?=\d+")/).slice(1);
    return {
      hasMore: /<a rel="next"/.test(html),
      results: blocks.map((b) => {
        const id = b.match(/^(\d+)"/)?.[1];
        const heading = b.match(/<h4 class="heading">([\s\S]*?)<\/h4>/)?.[1] ?? '';
        const title = stripHtml(heading.match(/<a href="\/works\/\d+">([\s\S]*?)<\/a>/)?.[1]);
        const authors = [...heading.matchAll(/rel="author"[^>]*>([^<]+)</g)].map((m) => stripHtml(m[1]));
        const fandoms = [...(b.match(/<h5 class="fandoms heading">([\s\S]*?)<\/h5>/)?.[1] ?? '').matchAll(/class="tag"[^>]*>([^<]+)</g)].map((m) => stripHtml(m[1]));
        const rating = b.match(/class="rating-[^"]*" title="([^"]+)"/)?.[1];
        const words = b.match(/<dd class="words">([^<]+)</)?.[1];
        const summary = stripHtml(b.match(/<blockquote class="userstuff summary">([\s\S]*?)<\/blockquote>/)?.[1]);
        const info = [fandoms.slice(0, 2).join(', '), rating, words && `${words} palavras`].filter(Boolean).join(' · ');
        return id && {
          id,
          title: title || `Obra ${id}`,
          authors: authors.length ? authors : ['Anônimo'],
          year: b.match(/<p class="datetime">\d+ \w+ (\d{4})<\/p>/)?.[1] ?? null,
          language: b.match(/<dd class="language" lang="([\w-]+)"/)?.[1]?.slice(0, 2) ?? null,
          description: [info, summary].filter(Boolean).join(' — ').slice(0, 400),
          cover: null,
          formats: ['epub', 'pdf'],
        };
      }).filter(Boolean),
    };
  },
  async resolve(id, format) {
    if (!/^\d+$/.test(id)) throw new Error('ID inválido');
    // The download filename and cache-busting timestamp are only on the work page.
    const html = await getText(`${AO3}/works/${id}?view_adult=true`, { timeout: 20000 });
    const href = html.match(new RegExp(`href="(/downloads/${id}/[^"]+\\.${format}(?:\\?[^"]*)?)"`))?.[1];
    return { url: `${AO3}${href ? href.replace(/&amp;/g, '&') : `/downloads/${id}/work.${format}`}` };
  },
};

export default [gutenberg, standard, archive, arxiv, ao3, syosetu, libgen];
