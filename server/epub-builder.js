// Turns chapters scraped from web-serial sites into a small EPUB 3 file.
// Chapter HTML comes from third-party pages, so it is rebuilt from a tag
// whitelist into well-formed XHTML: no scripts, no attributes, no remote loads.
import JSZip from 'jszip';
import { randomUUID } from 'node:crypto';

const ALLOWED = new Set([
  'p', 'br', 'hr', 'em', 'i', 'b', 'strong', 'u', 's', 'sub', 'sup', 'small', 'span', 'div',
  'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'ruby', 'rb', 'rt', 'rp',
  'table', 'thead', 'tbody', 'tr', 'td', 'th', 'pre', 'code',
]);
const VOID = new Set(['br', 'hr']);
// Elements dropped together with everything inside them.
const DROP = 'script|style|iframe|object|embed|noscript|template|svg|math|form|select|textarea|button|head|title';

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', laquo: '«', raquo: '»', middot: '·', copy: '©', reg: '®', trade: '™', times: '×', deg: '°' };

const decode = (s) => s.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] === '#') {
    const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1));
    return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
  }
  return NAMED[e.toLowerCase()] ?? m;
});

// Characters XML 1.0 does not allow at all, even escaped.
const INVALID_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;

export const escapeXml = (s = '') => String(s)
  .replace(INVALID_XML, '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

export function sanitize(html = '') {
  const src = String(html)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(new RegExp(`<(${DROP})\\b[\\s\\S]*?<\\/\\1\\s*>`, 'gi'), '')
    .replace(new RegExp(`<\\/?(${DROP})\\b[^>]*>`, 'gi'), '');
  const out = [];
  const stack = [];
  const token = /<\/?([a-zA-Z][\w-]*)\b[^>]*>|<![^>]*>|<\?[^>]*>|[^<]+|</g;
  for (const [raw, name] of src.matchAll(token)) {
    if (!name) {
      if (raw.startsWith('<!') || raw.startsWith('<?')) continue;
      out.push(escapeXml(decode(raw)));
      continue;
    }
    const tag = name.toLowerCase();
    if (!ALLOWED.has(tag)) continue; // Keep the text, lose the tag (links, images, fonts…).
    if (raw[1] === '/') {
      const at = stack.lastIndexOf(tag);
      if (at === -1) continue;
      while (stack.length > at) out.push(`</${stack.pop()}>`);
    } else if (VOID.has(tag)) {
      out.push(`<${tag}/>`);
    } else if (raw.endsWith('/>')) {
      out.push(`<${tag}></${tag}>`);
    } else {
      out.push(`<${tag}>`);
      stack.push(tag);
    }
  }
  while (stack.length) out.push(`</${stack.pop()}>`);
  return out.join('');
}

const page = (lang, title, body) => `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${lang}" lang="${lang}">
<head><meta charset="utf-8"/><title>${escapeXml(title)}</title><link rel="stylesheet" href="style.css"/></head>
<body>
${body}
</body>
</html>
`;

const STYLE = `body { margin: 0 4%; line-height: 1.75; }
h1, h2 { line-height: 1.35; margin: 1.2em 0 1em; }
h1 { font-size: 1.6em; text-align: center; margin-top: 3em; }
h2 { font-size: 1.25em; }
p { margin: 0 0 .15em; }
.by { text-align: center; font-style: italic; }
.about { margin-top: 3em; font-size: .92em; }
.source { margin-top: 3em; font-size: .8em; text-align: center; opacity: .7; }
.note { font-size: .9em; opacity: .85; }
hr { border: 0; border-top: 1px solid currentColor; opacity: .25; margin: 1.5em 20%; }
rt { font-size: .5em; }
`;

/**
 * @param {object} book
 * @param {string} book.title
 * @param {string[]} [book.authors]
 * @param {string} [book.language]   BCP 47 code, e.g. "ja"
 * @param {string} [book.description] plain text
 * @param {string} [book.sourceUrl]
 * @param {{ title: string, html: string, group?: string, before?: string, after?: string }[]} book.chapters
 *        `group` names the volume / arc a chapter belongs to; it nests the TOC.
 *        `before` / `after` are author's notes shown around the chapter text.
 * @returns {Promise<Buffer|Uint8Array>}
 */
export async function buildEpub({ title, authors = [], language = 'en', description = '', sourceUrl = '', chapters }) {
  if (!chapters?.length) throw new Error('Nenhum capítulo para montar o livro');
  const lang = /^[a-z]{2,3}(-[\w]+)?$/i.test(language) ? language : 'en';
  const uid = `urn:uuid:${randomUUID()}`;
  const modified = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const files = chapters.map((c, i) => ({ ...c, file: `c${String(i + 1).padStart(4, '0')}.xhtml`, id: `c${i + 1}` }));

  const zip = new JSZip();
  // The OCF spec requires "mimetype" first and uncompressed.
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file('META-INF/container.xml', `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>
`);
  zip.file('OEBPS/style.css', STYLE);

  const about = description.trim()
    ? `<div class="about">${description.trim().split(/\n+/).map((l) => `<p>${escapeXml(l)}</p>`).join('\n')}</div>`
    : '';
  zip.file('OEBPS/title.xhtml', page(lang, title, `<section epub:type="titlepage">
<h1>${escapeXml(title)}</h1>
${authors.length ? `<p class="by">${escapeXml(authors.join(', '))}</p>` : ''}
${about}
${sourceUrl ? `<p class="source">${escapeXml(sourceUrl)}</p>` : ''}
</section>`));

  for (const c of files) {
    zip.file(`OEBPS/${c.file}`, page(lang, c.title, `<section epub:type="chapter">
<h2>${escapeXml(c.title)}</h2>
${c.before ? `<div class="note">${sanitize(c.before)}</div>\n<hr/>` : ''}
${sanitize(c.html)}
${c.after ? `<hr/>\n<div class="note">${sanitize(c.after)}</div>` : ''}
</section>`));
  }

  // Nested TOC: a volume entry points at its first chapter.
  const tocItems = [];
  for (const c of files) {
    const li = `<li><a href="${c.file}">${escapeXml(c.title)}</a></li>`;
    const last = tocItems.at(-1);
    if (!c.group) tocItems.push({ li });
    else if (last?.group === c.group) last.children.push(li);
    else tocItems.push({ group: c.group, file: c.file, children: [li] });
  }
  const navList = tocItems.map((t) => t.li ?? `<li><a href="${t.file}">${escapeXml(t.group)}</a>\n<ol>\n${t.children.join('\n')}\n</ol></li>`).join('\n');
  zip.file('OEBPS/nav.xhtml', page(lang, 'Sumário', `<nav epub:type="toc" id="toc"><h1>Sumário</h1>
<ol>
${navList}
</ol>
</nav>`));

  // EPUB 2 NCX for older readers; flat is enough there.
  zip.file('OEBPS/toc.ncx', `<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
<head><meta name="dtb:uid" content="${uid}"/></head>
<docTitle><text>${escapeXml(title)}</text></docTitle>
<navMap>
${files.map((c, i) => `<navPoint id="n${i + 1}" playOrder="${i + 1}"><navLabel><text>${escapeXml(c.title)}</text></navLabel><content src="${c.file}"/></navPoint>`).join('\n')}
</navMap>
</ncx>
`);

  zip.file('OEBPS/content.opf', `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid" xml:lang="${lang}">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
  <dc:identifier id="uid">${uid}</dc:identifier>
  <dc:title>${escapeXml(title)}</dc:title>
  ${authors.map((a) => `<dc:creator>${escapeXml(a)}</dc:creator>`).join('\n  ')}
  <dc:language>${lang}</dc:language>
  ${description ? `<dc:description>${escapeXml(description)}</dc:description>` : ''}
  ${sourceUrl ? `<dc:source>${escapeXml(sourceUrl)}</dc:source>` : ''}
  <meta property="dcterms:modified">${modified}</meta>
</metadata>
<manifest>
  <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
  <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
  <item id="css" href="style.css" media-type="text/css"/>
  <item id="title" href="title.xhtml" media-type="application/xhtml+xml"/>
  ${files.map((c) => `<item id="${c.id}" href="${c.file}" media-type="application/xhtml+xml"/>`).join('\n  ')}
</manifest>
<spine toc="ncx">
  <itemref idref="title"/>
  ${files.map((c) => `<itemref idref="${c.id}"/>`).join('\n  ')}
</spine>
</package>
`);

  // A Buffer on the server; bytes in the iOS app (mobile/), which has no Buffer.
  const type = typeof Buffer === 'undefined' ? 'uint8array' : 'nodebuffer';
  return zip.generateAsync({ type, compression: 'DEFLATE', compressionOptions: { level: 6 }, mimeType: 'application/epub+zip' });
}
