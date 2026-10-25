// iOS app (capacitor.config.json): there is no server to talk to. The same API answers inside the
// page instead (mobile/server.js, which mobile/build.mjs bundles into the app as native-api.js).
export const native = window.Capacitor?.isNativePlatform?.() ? await import('./native-api.js') : null;

async function request(method, url, body, headers = {}) {
  if (native) return native.request(method, url, body, headers);
  const init = { method, headers: { ...headers } };
  if (body instanceof Blob || body instanceof File) {
    init.body = body;
  } else if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(url, init);
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (!res.ok) throw new Error(data?.error ?? `Erro ${res.status}`);
  return data;
}

export const api = {
  sources: () => request('GET', '/api/sources'),
  search: (source, q, page = 1, signal) => native
    ? native.request('GET', `/api/search?${new URLSearchParams({ source, q, page })}`, undefined, {}, signal)
    : fetch(`/api/search?${new URLSearchParams({ source, q, page })}`, { signal }).then(async (r) => {
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? `Erro ${r.status}`);
      return d;
    }),
  library: () => request('GET', '/api/library'),
  download: (result, format) =>
    request('POST', '/api/library', {
      source: result.source,
      id: result.id,
      format,
      url: result.downloads?.[format],
      meta: { title: result.title, authors: result.authors, year: result.year, language: result.language, cover: result.cover },
    }),
  job: (id) => request('GET', `/api/jobs/${id}`),
  import: (file) => request('POST', '/api/library/import', file, { 'X-Filename': encodeURIComponent(file.name) }),
  update: (id, patch) => request('PATCH', `/api/library/${id}`, patch),
  remove: (id) => request('DELETE', `/api/library/${id}`),
  setCover: (id, blob) => request('PUT', `/api/library/${id}/cover`, blob, { 'Content-Type': blob.type || 'image/jpeg' }),
  locations: (id) => request('GET', `/api/library/${id}/locations`),
  saveLocations: (id, data) => request('PUT', `/api/library/${id}/locations`, data),
  catalogs: () => request('GET', '/api/catalogs'),
  addCatalog: (c) => request('POST', '/api/catalogs', c),
  removeCatalog: (id) => request('DELETE', `/api/catalogs/${id}`),
  // iOS app only: sources the user adds from a link ({ url }) or a file ({ code }).
  addSource: (s) => request('POST', '/api/sources', s),
  removeSource: (id) => request('DELETE', `/api/sources/${id}`),
  collections: () => request('GET', '/api/collections'),
  addCollection: (name) => request('POST', '/api/collections', { name }),
  renameCollection: (id, name) => request('PATCH', `/api/collections/${id}`, { name }),
  removeCollection: (id) => request('DELETE', `/api/collections/${id}`),
  define: (word, lang, signal) => native
    ? native.request('GET', `/api/define?${new URLSearchParams({ word, lang: lang ?? '' })}`, undefined, {}, signal)
    : fetch(`/api/define?${new URLSearchParams({ word, lang: lang ?? '' })}`, { signal }).then(async (r) => {
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw Object.assign(new Error(d.error ?? `Erro ${r.status}`), { status: r.status });
      return d;
    }),
};

export const fileUrl = (book) => (native ? native.fileUrl(book) : `/api/library/${book.id}/file`);
export const coverUrl = (book) => {
  if (!book.cover) return null;
  return native ? native.coverUrl(book) : `/api/library/${book.id}/cover?v=${encodeURIComponent(book.cover)}`;
};
