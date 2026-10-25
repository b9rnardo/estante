// Sources the user adds (Fontes › Adicionar fonte) are code the Estante didn't write, so each one
// runs in a frame of its own: an opaque origin, with no way into this page, its storage or the
// library's files, under a policy that blocks every request it could make by itself. The one way
// out is asking this page for a web page or some JSON, which it fetches like any other source.
import { getText, getJSON, stripHtml } from '../server/http.js';

// Runs in the frame. A source is an ES module whose default export has id, name, description,
// search(q, page) and resolve(id, format), like the ones in server/sources, and it reaches the
// web through the `estante` global: getText(url, { headers, timeout }), getJSON(…), stripHtml, sleep.
const RUNTIME = `
const waiting = new Map();
let seq = 0;
let source = null;
const ask = (request) => new Promise((resolve, reject) => {
  const id = ++seq;
  waiting.set(id, { resolve, reject });
  parent.postMessage({ type: 'http', id, ...request }, '*');
});
const revive = (e) => Object.assign(new Error(e.message), { name: e.name, status: e.status, blocked: e.blocked });
const fail = (err) => ({ message: String(err?.message ?? err), name: err?.name, status: err?.status, blocked: err?.blocked });
const opts = (o) => ({ headers: o?.headers, timeout: o?.timeout });
globalThis.estante = Object.freeze({
  getText: (url, o) => ask({ url: String(url), as: 'text', ...opts(o) }),
  getJSON: (url, o) => ask({ url: String(url), as: 'json', ...opts(o) }),
  stripHtml: ${stripHtml},
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
});
addEventListener('message', async ({ source: from, data }) => {
  if (from !== parent || !data) return;
  if (data.type === 'reply') {
    const w = waiting.get(data.id);
    waiting.delete(data.id);
    if (w) data.error ? w.reject(revive(data.error)) : w.resolve(data.value);
    return;
  }
  const reply = (body) => parent.postMessage({ type: 'done', id: data.id, ...body }, '*');
  try {
    if (data.type === 'load') {
      const url = URL.createObjectURL(new Blob([data.code], { type: 'text/javascript' }));
      try { source = (await import(url)).default; } finally { URL.revokeObjectURL(url); }
      const ok = source && typeof source.search === 'function' && typeof source.resolve === 'function';
      reply({ value: ok ? { id: source.id, name: source.name, description: source.description, optIn: source.optIn } : null });
    } else if (data.type === 'call' && (data.method === 'search' || data.method === 'resolve')) {
      reply({ value: await source[data.method](...data.args) });
    }
  } catch (err) {
    reply({ error: fail(err) });
  }
});
parent.postMessage({ type: 'ready' }, '*');
`;

const POLICY = "default-src 'none'; script-src 'unsafe-inline' blob:";

const revive = (e) => Object.assign(new Error(e.message), { name: e.name, status: e.status, blocked: e.blocked });
const fail = (err) => ({ message: String(err?.message ?? err), name: err?.name, status: err?.status, blocked: err?.blocked });

function withTimeout(promise, ms, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); }),
  ]).finally(() => clearTimeout(timer));
}

// A request from a source: text or JSON over http(s) (getText refuses anything else), with
// its own headers and a timeout of at most a minute.
function fetchFor({ url, as, headers, timeout }) {
  const h = {};
  for (const [k, v] of Object.entries(headers ?? {})) if (typeof v === 'string') h[k] = v;
  const opts = { headers: h, timeout: Math.min(Number(timeout) || 15000, 60000) };
  return as === 'json' ? getJSON(url, opts) : getText(url, opts);
}

// Starts a source from its code. Resolves with what it says about itself, a call(method, ...args)
// for search and resolve, and close(); rejects if the code doesn't load or isn't a source.
export async function open(code) {
  const frame = document.createElement('iframe');
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.hidden = true;
  frame.srcdoc = `<!doctype html><meta http-equiv="Content-Security-Policy" content="${POLICY}"><script>${RUNTIME}</script>`;

  const calls = new Map();
  let seq = 0;
  let ready;
  const started = new Promise((resolve) => { ready = resolve; });
  const onMessage = async ({ source, data }) => {
    if (source !== frame.contentWindow || !data) return;
    if (data.type === 'ready') return ready();
    if (data.type === 'done') {
      const c = calls.get(data.id);
      calls.delete(data.id);
      if (c) data.error ? c.reject(revive(data.error)) : c.resolve(data.value);
    } else if (data.type === 'http') {
      let reply;
      try { reply = { value: await fetchFor(data) }; } catch (err) { reply = { error: fail(err) }; }
      frame.contentWindow?.postMessage({ type: 'reply', id: data.id, ...reply }, '*');
    }
  };
  const send = (message) => new Promise((resolve, reject) => {
    const id = ++seq;
    calls.set(id, { resolve, reject });
    frame.contentWindow.postMessage({ ...message, id }, '*');
  });
  const close = () => {
    window.removeEventListener('message', onMessage);
    frame.remove();
    for (const c of calls.values()) c.reject(new Error('A fonte foi removida'));
  };

  window.addEventListener('message', onMessage);
  document.body.append(frame);
  try {
    await withTimeout(started, 10000, 'A fonte não abriu');
    const info = await withTimeout(send({ type: 'load', code }), 15000, 'A fonte demorou demais para abrir');
    if (!info) throw new Error('O arquivo não parece uma fonte da Estante: faltam as funções search e resolve');
    return { info, call: (method, ...args) => send({ type: 'call', method, args }), close };
  } catch (err) {
    close();
    throw err;
  }
}
