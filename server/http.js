// Small fetch helpers shared by every source.

const UA = 'Estante/0.1 (leitor pessoal de e-books)';

// Accepts URLs with inline credentials (https://user:pass@host/...) and turns them
// into a Basic auth header, since fetch() refuses credentials in the URL.
function prepare(url, headers = {}) {
  const u = new URL(url);
  if (!/^https?:$/.test(u.protocol)) throw new Error(`Protocolo não suportado: ${u.protocol}`);
  const h = { 'User-Agent': UA, ...headers };
  if (u.username || u.password) {
    const token = Buffer.from(`${decodeURIComponent(u.username)}:${decodeURIComponent(u.password)}`).toString('base64');
    h.Authorization = `Basic ${token}`;
    u.username = '';
    u.password = '';
  }
  return { url: u.toString(), headers: h };
}

export async function get(url, { headers, timeout = 15000 } = {}) {
  const req = prepare(url, headers);
  const res = await fetch(req.url, {
    headers: req.headers,
    redirect: 'follow',
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) {
    const host = new URL(req.url).host;
    const err = new Error(res.status >= 500 ? `${host} está fora do ar ou sobrecarregado (HTTP ${res.status})` : `HTTP ${res.status} em ${host}`);
    err.status = res.status;
    throw err;
  }
  return res;
}

export async function getJSON(url, opts) {
  return (await get(url, opts)).json();
}

export async function getText(url, opts) {
  return (await get(url, opts)).text();
}

export function stripHtml(s = '') {
  return String(s)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
