// Shōsetsuka ni Narō (syosetu.com): Japan's biggest site for novels published by
// their own authors. Search uses the official novel API; the EPUB is assembled
// from the chapter pages, one request per second as the site's robots.txt asks.
import { getJSON, stripHtml } from '../http.js';
import { buildEpub } from '../epub-builder.js';
import { politeText, fetchChapter, innerAt } from './serial.js';

const API = 'https://api.syosetu.com/novelapi/api/';
const SITE = 'https://ncode.syosetu.com';
const PER_PAGE = 20;
const NCODE = /^n\d{4}[a-z]{1,3}$/;

async function query(params) {
  const qs = new URLSearchParams({ out: 'json', of: 't-n-w-s-ga-nt-e-gf', ...params });
  const [head, ...items] = await getJSON(`${API}?${qs}`, { timeout: 20000 });
  return { count: head?.allcount ?? 0, items };
}

const year = (date) => date?.slice(0, 4) ?? null;

function toResult(n) {
  // `end` is 0 for finished serials and for short stories, 1 while still running.
  const info = n.noveltype === 2 ? 'Conto' : `${n.general_all_no} episódios · ${n.end === 0 ? 'completo' : 'em andamento'}`;
  return {
    id: n.ncode.toLowerCase(),
    title: n.title.trim(),
    authors: [n.writer.trim()],
    year: year(n.general_firstup),
    language: 'ja',
    description: `${info} — ${stripHtml(n.story)}`.slice(0, 400),
    cover: null,
    formats: ['epub'],
  };
}

// Chapter text plus the author's notes before/after it, when present.
function chapterBody(html) {
  const parts = {};
  for (const m of html.matchAll(/<div class="js-novel-text p-novel__text(?: p-novel__text--(\w+))?">/g)) {
    parts[m[1] ?? 'main'] ??= innerAt(html, m.index);
  }
  if (parts.main == null) throw new Error('Não reconheci a página do capítulo; o Syosetu pode ter mudado o layout');
  return { html: parts.main, before: parts.preface, after: parts.afterword };
}

// The table of contents lists 100 episodes per page, with volume headings between them.
async function episodes(id) {
  const list = [];
  let group = null;
  for (let p = 1; p <= 200; p++) {
    const html = await politeText(`${SITE}/${id}/${p > 1 ? `?p=${p}` : ''}`);
    const items = /<div class="p-eplist__chapter-title">([\s\S]*?)<\/div>|<a href="\/\w+\/(\d+)\/" class="p-eplist__subtitle">([\s\S]*?)<\/a>/g;
    for (const m of html.matchAll(items)) {
      if (m[1] !== undefined) group = stripHtml(m[1]) || null;
      else list.push({ no: m[2], title: stripHtml(m[3]) || `Episódio ${m[2]}`, group });
    }
    if (!/<a [^>]*class="c-pager__item c-pager__item--next"/.test(html)) break;
  }
  if (!list.length) throw new Error('Não encontrei a lista de capítulos desta obra');
  return list;
}

async function chapters(id, novel, progress) {
  if (novel.noveltype === 2) {
    progress(0, 1);
    const page = await fetchChapter(`${SITE}/${id}/`);
    progress(1, 1);
    return [{ title: novel.title.trim(), ...chapterBody(page) }];
  }
  progress(0, novel.general_all_no || null);
  const list = await episodes(id);
  const out = [];
  for (const [i, ep] of list.entries()) {
    progress(i, list.length);
    let page;
    try {
      page = await fetchChapter(`${SITE}/${id}/${ep.no}/`);
    } catch (err) {
      if (err.status === 404 || err.status === 410) continue; // Removed after the index was read.
      throw err;
    }
    const body = chapterBody(page);
    if (stripHtml(body.html)) out.push({ title: ep.title, group: ep.group, ...body });
  }
  progress(list.length, list.length);
  return out;
}

export default {
  id: 'syosetu',
  name: 'Syosetu',
  description: 'Web novels japonesas publicadas pelos autores (Shōsetsuka ni Narō)',
  async search(q, page = 1) {
    const st = (page - 1) * PER_PAGE + 1;
    if (st > 2000) return { results: [], hasMore: false }; // The API stops paging there.
    const { count, items } = await query({ word: q, lim: PER_PAGE, st, order: 'hyoka' });
    return { results: items.map(toResult), hasMore: st + PER_PAGE <= Math.min(count, 2000) };
  },
  async resolve(id) {
    if (!NCODE.test(id)) throw new Error('Código de obra inválido');
    const { items: [novel] } = await query({ ncode: id });
    if (!novel) throw new Error('Obra não encontrada no Syosetu; ela pode ter sido removida');
    const meta = { title: novel.title.trim(), authors: [novel.writer.trim()], language: 'ja', year: year(novel.general_firstup) };
    return {
      meta,
      build: async (progress) => buildEpub({
        ...meta,
        description: String(novel.story ?? '').replace(/\r/g, ''),
        sourceUrl: `${SITE}/${id}/`,
        chapters: await chapters(id, novel, progress),
      }),
    };
  },
};
