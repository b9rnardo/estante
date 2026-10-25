// Dictionary for the reader. Asks the Portuguese Wiktionary first (definitions in
// Portuguese, also for English, Spanish… words) and falls back to the English
// Wiktionary, whose definitions are in English. Works the same on every OS.
import { getJSON } from './http.js';

const MAX_ENTRIES = 6;
const MAX_SENSES = 8;
const cache = new Map(); // "lang|word" -> result or null, newest last

// Headings that hold no definitions of their own.
const NOT_POS = /etimologia|pronúncia|tradu|sinôn|antôn|hipôn|hiperôn|parônim|cognat|ver também|expressões|fraseologia|anagrama|descendente|derivad|relacionad|formas? alternativa|grafia|ligações|referências|notas?$|uso|conjugação|declinação|divisão|citações|provérbio|imagens|galeria/i;

const EN_POS = {
  Noun: 'Substantivo', Verb: 'Verbo', Adjective: 'Adjetivo', Adverb: 'Advérbio', Pronoun: 'Pronome',
  Preposition: 'Preposição', Conjunction: 'Conjunção', Interjection: 'Interjeição', Article: 'Artigo',
  Determiner: 'Determinante', Numeral: 'Numeral', 'Proper noun': 'Nome próprio', Phrase: 'Expressão',
  Prefix: 'Prefixo', Suffix: 'Sufixo', Contraction: 'Contração', Particle: 'Partícula', Participle: 'Particípio',
};

// Entities only: spacing matters here, since segments are joined back together.
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = (s) => s.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (m, e) => (e[0] !== '#' ? ENTITIES[e.toLowerCase()] ?? m
  : String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)))));
const untag = (s) => decode(s.replace(/<[^>]+>/g, ''));

// Wikitext of one definition line -> [{ t, link? }], links kept so the reader can follow them.
function wikiInline(src) {
  let s = src
    .replace(/<ref[^>]*\/>/g, '')
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  for (let i = 0; i < 8 && /\{\{[^{}]*\}\}/.test(s); i++) s = s.replace(/\{\{([^{}]*)\}\}/g, (_, body) => wikiTemplate(body));
  s = s.replace(/'{2,}/g, '').replace(/<[^>]+>/g, '');
  const out = [];
  let last = 0;
  for (const m of s.matchAll(/\[\[([^\]|]*)(?:\|([^\]]*))?\]\]/g)) {
    if (m.index > last) out.push({ t: s.slice(last, m.index) });
    const target = m[1].split('#')[0].trim();
    if (!/^(categoria|category|imagem|image|file|arquivo|ficheiro):/i.test(target)) {
      const label = (m[2] ?? m[1].split('#')[0]).trim();
      out.push(target ? { t: label, link: target } : { t: label });
    }
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push({ t: s.slice(last) });
  return tidy(out.map((x) => ({ ...x, t: decode(x.t) })));
}

function wikiTemplate(body) {
  const [name = '', ...args] = body.split('|').map((x) => x.trim());
  const n = name.toLowerCase();
  const plain = args.filter((a) => a && !a.includes('='));
  if (/^(escopo|rótulo|rotulo|contexto)$/.test(n)) return plain.length > 1 ? `(${plain.slice(1).join(', ')}) ` : '';
  if (n === 'escopo2') return plain.length ? `(${plain.join(', ')}) ` : '';
  if (/^(l|ll|link|lig|link preto|termo|m)$/.test(n)) return plain[plain.length > 1 ? 1 : 0] ?? '';
  return '';
}

// Joins adjacent plain text and trims the ends.
function tidy(segs) {
  const out = [];
  for (const s of segs) {
    if (!s.t) continue;
    const prev = out[out.length - 1];
    if (prev && !prev.link && !s.link) prev.t += s.t;
    else out.push({ ...s });
  }
  for (const s of out) s.t = s.t.replace(/\s+/g, ' ');
  if (out.length) {
    out[0].t = out[0].t.replace(/^[\s,;:.]+/, '');
    out[out.length - 1].t = out[out.length - 1].t.replace(/\s+$/, '');
  }
  return out.filter((s) => s.t);
}

// pt.wiktionary page -> { lang: [{ pos, senses }] }, one key per language section ("={{-pt-}}=").
function parsePt(wikitext) {
  const byLang = {};
  const heads = [...wikitext.matchAll(/^=\s*\{\{-([a-z]{2,3}(?:-[a-z]+)?)-\}\}\s*=\s*$/gm)];
  heads.forEach((h, i) => {
    const text = wikitext.slice(h.index + h[0].length, heads[i + 1]?.index ?? wikitext.length);
    const entries = [];
    let pos = null;
    for (const line of text.split('\n')) {
      const head = line.match(/^(={2,})\s*(.+?)\s*\1\s*$/);
      if (head) {
        const name = head[2].replace(/\{\{([^|}]+)(?:\|[^}]*)?\}\}/g, '$1').replace(/\s+\d+$/, '').trim();
        pos = !name || name.startsWith('-') || NOT_POS.test(name) ? null : name;
        continue;
      }
      const def = pos && line.match(/^#(?![:*#])\s*(.+)$/);
      if (!def) continue;
      const sense = wikiInline(def[1]);
      if (!sense.length) continue;
      let entry = entries.find((e) => e.pos === pos);
      if (!entry) entries.push((entry = { pos, senses: [] }));
      if (entry.senses.length < MAX_SENSES) entry.senses.push(sense);
    }
    if (entries.length) byLang[h[1]] = entries.slice(0, MAX_ENTRIES);
  });
  return byLang;
}

async function ptWiktionary(word) {
  const url = `https://pt.wiktionary.org/w/api.php?${new URLSearchParams({
    action: 'parse', page: word, prop: 'wikitext', format: 'json', formatversion: '2', redirects: '1',
  })}`;
  const data = await getJSON(url, { timeout: 8000 });
  if (!data.parse?.wikitext) return null;
  return { title: data.parse.title, byLang: parsePt(data.parse.wikitext) };
}

// en.wiktionary REST: { en: [{ partOfSpeech, definitions: [{ definition: html }] }], pt: … }
async function enWiktionary(word) {
  let data;
  try {
    data = await getJSON(`https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(word)}`, { timeout: 8000 });
  } catch (err) {
    if (err.status === 404) return null;
    throw err;
  }
  const byLang = {};
  for (const [lang, list] of Object.entries(data ?? {})) {
    const entries = [];
    for (const item of Array.isArray(list) ? list : []) {
      if (/^(Symbol|Letter|Romanization)$/.test(item.partOfSpeech)) continue; // ISO codes and the like
      const senses = (item.definitions ?? [])
        .map((d) => htmlInline(d.definition ?? ''))
        .filter((s) => s.length)
        .slice(0, MAX_SENSES);
      if (senses.length) entries.push({ pos: EN_POS[item.partOfSpeech] ?? item.partOfSpeech, senses });
    }
    if (entries.length) byLang[lang] = entries.slice(0, MAX_ENTRIES);
  }
  return { title: word, byLang };
}

function htmlInline(html) {
  const out = [];
  let last = 0;
  const s = html.replace(/<(ul|ol|dl)[\s\S]*$/i, ''); // nested example lists
  for (const m of s.matchAll(/<a\b[^>]*?title="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)) {
    if (m.index > last) out.push({ t: untag(s.slice(last, m.index)) });
    const link = decode(m[1]).split('#')[0];
    out.push(/:/.test(link) ? { t: untag(m[2]) } : { t: untag(m[2]), link });
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push({ t: untag(s.slice(last)) });
  return tidy(out);
}

const variants = (word) => [...new Set([word, word.toLowerCase()])];

async function lookup(word, lang) {
  let pt = null;
  for (const w of variants(word)) {
    const page = await ptWiktionary(w).catch((err) => { if (err.status && err.status < 500) return null; throw err; });
    if (page && Object.keys(page.byLang).length) {
      pt ??= page;
      if (page.byLang[lang]) { pt = page; break; }
    }
  }
  const result = (page, entries, entryLang, source) => ({
    word: page.title,
    lang: entryLang,
    entries,
    source,
    url: `https://${source}/wiki/${encodeURIComponent(page.title.replace(/ /g, '_'))}`,
  });
  if (pt?.byLang[lang]) return result(pt, pt.byLang[lang], lang, 'pt.wiktionary.org');

  let en = null;
  for (const w of variants(word)) {
    en = await enWiktionary(w);
    if (en?.byLang[lang]) break;
  }
  if (en?.byLang[lang]) return result(en, en.byLang[lang], lang, 'en.wiktionary.org');

  // The book's language is unknown or has no entry: show whatever exists, Portuguese first.
  const firstOf = (page) => page && (page.byLang.pt ? 'pt' : Object.keys(page.byLang)[0]);
  if (firstOf(pt)) return result(pt, pt.byLang[firstOf(pt)], firstOf(pt), 'pt.wiktionary.org');
  if (firstOf(en)) return result(en, en.byLang[firstOf(en)], firstOf(en), 'en.wiktionary.org');
  return null;
}

// `lang` is the book's language ("pt", "en-US", "por"…); anything unknown counts as Portuguese.
const ISO3 = { por: 'pt', eng: 'en', spa: 'es', fra: 'fr', fre: 'fr', deu: 'de', ger: 'de', ita: 'it', lat: 'la', nld: 'nl', dut: 'nl', jpn: 'ja', rus: 'ru' };
export function normalizeLang(lang) {
  const base = String(lang ?? '').trim().toLowerCase().split(/[-_]/)[0];
  return ISO3[base] ?? (/^[a-z]{2}$/.test(base) ? base : 'pt');
}

export async function define(word, lang) {
  const w = String(word).normalize('NFC').replace(/^[\p{P}\p{S}\s]+|[\p{P}\p{S}\s]+$/gu, '').slice(0, 80);
  if (!w) return null;
  const l = normalizeLang(lang);
  const key = `${l}|${w}`;
  if (cache.has(key)) {
    const hit = cache.get(key);
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const found = await lookup(w, l);
  cache.set(key, found);
  if (cache.size > 300) cache.delete(cache.keys().next().value);
  return found;
}
