// Library Genesis: an unofficial library of books and papers, most of them still
// under copyright. Ported from annas.koplugin (KOReader), which searches libgen
// first and downloads every file through libgen's mirrors. Anna's Archive, the
// plugin's fallback, answers non-browser clients with a DDoS-Guard check, so it
// is not used. Off in "Todas" until the user turns it on (optIn).
import { getText, stripHtml } from '../http.js';
import { CHALLENGE, blocked } from './serial.js';

// Mirrors running the libgen.li code. The one that answered last is tried first.
const MIRRORS = ['libgen.li', 'libgen.la', 'libgen.bz', 'libgen.vg', 'libgen.gl'];
let preferred = MIRRORS[0];

async function fromMirrors(path, isValid, timeout) {
  let refused = null;
  for (const host of [preferred, ...MIRRORS.filter((m) => m !== preferred)]) {
    try {
      const html = await getText(`https://${host}${path}`, { timeout });
      if (isValid(html)) {
        preferred = host;
        return { host, html };
      }
      // A 200 that is not libgen: a parked domain, an error page or a bot check.
      if (CHALLENGE.test(html)) refused = host;
    } catch (err) {
      if (err.status === 403 || err.status === 429) refused = host;
    }
  }
  if (refused) throw blocked(`https://${refused}/`);
  throw new Error('Nenhum espelho do Library Genesis respondeu; tente de novo mais tarde');
}

const FORMATS = ['epub', 'pdf']; // The rest (MOBI, DJVU, FB2…) the reader cannot open.
const LANG = {
  Arabic: 'ar', Armenian: 'hy', Azerbaijani: 'az', Bengali: 'bn', Chinese: 'zh', Czech: 'cs', Dutch: 'nl',
  English: 'en', Finnish: 'fi', French: 'fr', Georgian: 'ka', German: 'de', Greek: 'el', Hindi: 'hi',
  Indonesian: 'id', Italian: 'it', Japanese: 'ja', Korean: 'ko', Latin: 'la', Malay: 'ms', Pashto: 'ps',
  Polish: 'pl', Portuguese: 'pt', Russian: 'ru', Serbian: 'sr', Slovak: 'sk', Spanish: 'es', Telugu: 'te',
  Thai: 'th', Turkish: 'tr', Ukrainian: 'uk', Urdu: 'ur', Vietnamese: 'vi',
};

// Tooltips carry "<br>" inside title="…", which would cut a tag short in stripHtml.
const text = (html) => stripHtml(String(html ?? '').replace(/\s(?:title|data-[\w-]+)="[^"]*"/g, ''));

// The cell holds an optional <b> line (series, or journal and issue for articles),
// then the edition links: the title first, ISBN or DOI after it.
function titleOf(cell) {
  for (const m of cell.matchAll(/href="edition\.php[^"]*">([\s\S]*?)<\/a>/g)) {
    const t = text(m[1].replace(/<i>[\s\S]*?<\/i>/g, ''));
    if (t) return t;
  }
  return null;
}

// "Assis, Machado de" -> "Machado de Assis"; "Gabriel Corrêa, Machado de Assis" is two people.
function people(name) {
  const parts = name.split(/\s*,\s*/);
  if (parts.length !== 2 || !parts[0] || !parts[1]) return [name];
  const [last, first] = parts;
  return last.includes(' ') && first.includes(' ') ? parts : [`${first} ${last}`];
}

function authorsOf(cell) {
  const seen = new Set();
  return text(cell.replace(/<label[\s\S]*?<\/label>/g, '')) // the "[...]" toggle for hidden extra authors
    .split(/\s*;\s*/)
    .map((n) => n.replace(/\s*\([^)]*\)|\s*\[[^\]]*\]/g, '').trim()) // "(Author)", "[Tolstoy, Lev Nikolayevich]"
    .filter(Boolean)
    .flatMap(people)
    .filter((n) => !seen.has(n.toLowerCase()) && seen.add(n.toLowerCase()))
    .slice(0, 5);
}

// One row per file: [cover,] title, authors, publisher, year, language, pages, size, extension, mirrors.
function parseRow(row) {
  const md5 = row.match(/ads\.php\?md5=([a-f\d]{32})/i)?.[1].toLowerCase();
  const td = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
  if (!md5 || td.length < 9) return null;
  const [main, authors, publisher, year, language, pages, size, ext] = td.slice(-9, -1);
  const format = text(ext).toLowerCase();
  if (!FORMATS.includes(format)) return null;
  const series = text(main.match(/^\s*<b>([\s\S]*?)<\/b>/)?.[1]);
  const n = Number(text(pages));
  return {
    id: md5,
    title: titleOf(main) || series || 'Sem título',
    authors: authorsOf(authors),
    year: text(year).match(/\d{4}/)?.[0] ?? null,
    language: LANG[text(language).split(/[;,]/)[0].trim()] ?? null,
    description: [series, text(publisher), n > 0 && `${n} páginas`, text(size)].filter(Boolean).join(' · ') || null,
    // libgen's covers are tiny thumbnails behind hotlink protection; covers.js
    // takes the cover from the file itself once it is on the shelf.
    cover: null,
    formats: [format],
  };
}

const fold = (s) => String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const words = (s) => fold(s).match(/[\p{L}\p{N}]+/gu) ?? [];

// libgen has no relevance order, so rank each page the way the plugin does.
function score(r, query, phrase) {
  const titleWords = words(r.title);
  const title = titleWords.join(' ');
  const inTitle = new Set(titleWords);
  const inAuthors = new Set(r.authors.flatMap(words));
  let s = title === phrase ? 100 : title.includes(phrase) ? 50 : 0;
  let all = true;
  for (const w of query) {
    if (inTitle.has(w)) s += 10;
    else if (title.includes(w)) s += 4; // part of a longer word ("marx" in "marxism")
    else all = false;
    if (inAuthors.has(w)) s += 8;
  }
  return all ? s + 20 : s;
}

function rank(results, q) {
  const query = words(q);
  if (!query.length) return results;
  const phrase = query.join(' ');
  const scores = new Map(results.map((r) => [r, score(r, query, phrase)]));
  return results.sort((a, b) => scores.get(b) - scores.get(a));
}

// libgen ignores res= and serves 25 files per page. Rows in other formats are
// dropped, so one page of results may span several libgen pages; remember
// where the next one starts.
const cursors = new Map();
const cursorKey = (q, page) => `${q}\n${page}`;
// The "Files N" tab is on every results page, even with no results; the home page has none.
const isResultsPage = (html) => /Files <span class="badge[^"]*">\d+<\/span>/.test(html);

export default {
  id: 'libgen',
  name: 'Library Genesis',
  description: 'Acervo não oficial de livros e artigos; boa parte ainda tem direitos autorais',
  optIn: true,
  async search(q, page = 1) {
    let lg = page === 1 ? 1 : (cursors.get(cursorKey(q, page)) ?? page);
    let pages = lg; // until libgen's paginator says how many there are
    const results = [];
    // A page of nothing but MOBIs and DJVUs would come back empty: read on a little.
    for (let read = 0; read < 3 && !results.length && lg <= pages; read++, lg++) {
      const { html } = await fromMirrors(`/index.php?${new URLSearchParams({ req: q, page: String(lg) })}`, isResultsPage, 20000);
      results.push(...[...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].map((m) => parseRow(m[1])).filter(Boolean));
      pages = Number(html.match(/new Paginator\("[^"]*",\s*(\d+)/)?.[1] ?? 1);
    }
    const hasMore = lg <= pages;
    if (hasMore) {
      if (cursors.size > 500) cursors.delete(cursors.keys().next().value);
      cursors.set(cursorKey(q, page + 1), lg);
    }
    return { results: rank(results, q), hasMore };
  },
  async resolve(id) {
    if (!/^[a-f\d]{32}$/.test(id)) throw new Error('ID inválido');
    // The download page hands out a short-lived key; get.php then redirects to libgen's CDN.
    const { host, html } = await fromMirrors(`/ads.php?md5=${id}`, (h) => /href="[^"]*get\.php\?md5=/.test(h), 15000);
    const href = html.match(/href="([^"]*get\.php\?md5=[^"]+)"/)[1].replace(/&amp;/g, '&');
    return { url: new URL(href, `https://${host}/`).toString() };
  },
};
