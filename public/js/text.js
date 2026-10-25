// Search that ignores case, accents and line breaks ("voce" finds "Você") but reports
// positions in the original text, so hits can be turned back into ranges.

const MARKS = /\p{M}/gu;
const SPACE = /\s/;
export const fold = (s) => s.normalize('NFD').replace(MARKS, '').toLowerCase().replace(/\s+/g, ' ');

// Folds `text` one character at a time; map[i] is the original index of folded char i.
export function foldMap(text) {
  const out = [];
  const map = [];
  for (let i = 0; i < text.length; i++) {
    if (SPACE.test(text[i])) {
      if (out[out.length - 1] !== ' ') { out.push(' '); map.push(i); }
      continue;
    }
    const c = text.charCodeAt(i);
    const f = c < 128 ? text[i].toLowerCase() : fold(text[i]);
    for (const ch of f) { out.push(ch); map.push(i); }
  }
  return { text: out.join(''), map };
}

// [start, end) ranges in the original text for every hit of `needle` (already folded).
export function findAll(folded, needle, limit = Infinity) {
  const hits = [];
  if (!needle) return hits;
  for (let i = folded.text.indexOf(needle); i !== -1 && hits.length < limit; i = folded.text.indexOf(needle, i + needle.length)) {
    hits.push([folded.map[i], folded.map[i + needle.length - 1] + 1]);
  }
  return hits;
}

// A line of context around a hit: { before, match, after }, whitespace collapsed.
export function excerpt(text, start, end, room = 60) {
  const squash = (s) => s.replace(/\s+/g, ' ');
  let before = squash(text.slice(Math.max(0, start - room), start)).trimStart();
  let after = squash(text.slice(end, end + room * 1.6)).trimEnd();
  if (start > room) before = `…${before.replace(/^\S*\s/, '')}`;
  if (end + room * 1.6 < text.length) after = `${after.replace(/\s\S*$/, '')}…`;
  return { before, match: squash(text.slice(start, end)), after };
}
