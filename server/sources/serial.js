// Shared plumbing for sites that publish books chapter by chapter.
// Requests to each host go out one at a time with a pause in between, the pace
// robots.txt asks for. A bot check is reported, never worked around.
import { get } from '../http.js';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const lanes = new Map(); // host -> promise that settles when the next request may start

function politeGet(url, { delay = 1000, timeout = 20000 } = {}) {
  const host = new URL(url).host;
  const run = (lanes.get(host) ?? Promise.resolve()).then(() => get(url, { timeout }));
  lanes.set(host, run.catch(() => {}).then(() => sleep(delay)));
  return run;
}

export const CHALLENGE = /<title>\s*(Just a moment|Attention Required|Access denied|DDoS-Guard)|cf-chl-|challenge-platform/i;

export function blocked(url) {
  const err = new Error(`${new URL(url).host} bloqueou o acesso automatizado (proteção anti-robô). A Estante não tenta contornar esse tipo de bloqueio.`);
  err.blocked = true;
  return err;
}

export async function politeText(url, opts) {
  let html;
  try {
    html = await (await politeGet(url, opts)).text();
  } catch (err) {
    if (err.status === 403 || err.status === 429) throw blocked(url);
    throw err;
  }
  if (CHALLENGE.test(html)) throw blocked(url);
  return html;
}

// Like politeText, but rides out a flaky moment: a 300-chapter book should not
// fail because one request timed out.
export async function fetchChapter(url, opts) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await politeText(url, opts);
    } catch (err) {
      const transient = err.name === 'TimeoutError' || err.status >= 500 || (!err.status && !err.blocked && err.name === 'TypeError');
      if (!transient || attempt >= 2) throw err;
      await sleep(attempt ? 15000 : 5000);
    }
  }
}

// Inner HTML of the element whose opening tag starts at `start`, nesting-aware.
export function innerAt(html, start) {
  const open = html.slice(start, start + 500).match(/^<(\w+)[^>]*>/);
  if (!open) return null;
  const re = new RegExp(`<(/?)${open[1]}\\b[^>]*>`, 'gi');
  re.lastIndex = start + open[0].length;
  let depth = 1;
  for (let t; (t = re.exec(html)); ) {
    if (!(depth += t[1] ? -1 : 1)) return html.slice(start + open[0].length, t.index);
  }
  return null;
}
