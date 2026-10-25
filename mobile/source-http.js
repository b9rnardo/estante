// server/http.js as an external source sees it (mobile/build.mjs builds the files in dist/fontes
// with this in its place): requests go through the app (mobile/sandbox.js), the only network
// access a source has, and only for text and JSON.
export { stripHtml } from '../server/http.js';

export const getText = (url, opts) => globalThis.estante.getText(url, opts);
export const getJSON = (url, opts) => globalThis.estante.getJSON(url, opts);
export function get() {
  throw new Error('Uma fonte externa só lê texto e JSON: use getText ou getJSON');
}
