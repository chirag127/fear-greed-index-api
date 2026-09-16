// Shared helpers: HTTP with browser-ish headers + retry, date normalisation, series store.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { dirname } from 'node:path';

export const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** GET a URL as text, with retries. Some government/broker sites reject bare clients. */
export async function fetchText(url, { headers = {}, tries = 3, timeout = 25000 } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9', ...headers },
        signal: AbortSignal.timeout(timeout),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      lastErr = e;
      if (attempt < tries) await sleep(400 * attempt);
    }
  }
  throw new Error(`${url} failed after ${tries} tries: ${lastErr?.message}`);
}

export async function fetchJson(url, opts = {}) {
  const text = await fetchText(url, opts);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${url} did not return JSON: ${text.slice(0, 120)}`);
  }
}

/**
 * NSE gates /api/* behind a session cookie. Warming up on the homepage then
 * re-requesting with the returned cookie is the documented workaround.
 */
export async function fetchNseJson(path) {
  const base = 'https://www.nseindia.com';
  const direct = await fetchText(base + path, {
    headers: { Referer: `${base}/`, Accept: 'application/json, text/plain, */*' },
    tries: 1,
  }).catch(() => null);
  if (direct) {
    try {
      return JSON.parse(direct);
    } catch {
      /* fall through to cookie warm-up */
    }
  }
  const warm = await fetch(base, { headers: { 'User-Agent': UA } });
  const cookie = (warm.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
  const text = await fetchText(base + path, {
    headers: {
      Referer: `${base}/`,
      Cookie: cookie,
      Accept: 'application/json, text/plain, */*',
    },
  });
  return JSON.parse(text);
}

/** Accepts ISO, ms-epoch, s-epoch, or "16-Sep-2026" and returns YYYY-MM-DD. */
export function toDate(v) {
  if (v == null) return null;
  if (typeof v === 'number' || /^\d+$/.test(String(v))) {
    const n = Number(v);
    // Anything below ~1e11 is seconds, above is milliseconds.
    const ms = n < 1e11 ? n * 1000 : n;
    return new Date(ms).toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  const dmy = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if (dmy) {
    const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    const m = months.indexOf(dmy[2].toLowerCase()) + 1;
    if (m) return `${dmy[3]}-${String(m).padStart(2, '0')}-${String(dmy[1]).padStart(2, '0')}`;
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

export const round = (v, dp = 2) =>
  v == null || !Number.isFinite(Number(v)) ? null : Number(Number(v).toFixed(dp));

const dataDir = (p) => new URL(`../../data/${p}`, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

export function readSeries(id) {
  const f = dataDir(`series/${id}.json`);
  if (!existsSync(f)) return { id, points: [] };
  try {
    return JSON.parse(readFileSync(f, 'utf8'));
  } catch {
    return { id, points: [] };
  }
}

export function writeSeries(id, points) {
  const dir = dataDir('series');
  mkdirSync(dir, { recursive: true });
  const clean = mergePoints([], points);
  writeFileSync(
    dataDir(`series/${id}.json`),
    JSON.stringify({ id, updated: new Date().toISOString(), points: clean }, null, 0) + '\n',
  );
  return clean.length;
}

/** Merge points, de-duplicating on date (later value wins), sorted ascending. */
export function mergePoints(existing, incoming) {
  const byDate = new Map();
  for (const [d, v] of existing ?? []) if (d && v != null && Number.isFinite(Number(v))) byDate.set(d, round(v, 4));
  for (const [d, v] of incoming ?? []) if (d && v != null && Number.isFinite(Number(v))) byDate.set(d, round(v, 4));
  return [...byDate.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

/** Append one observation to a stored series (used by the hourly/intraday path). */
export function appendSeries(id, date, value) {
  const existing = readSeries(id).points;
  return writeSeries(id, mergePoints(existing, [[date, value]]));
}

export function listSeries() {
  const dir = dataDir('series');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json') && f !== 'index.json')
    .map((f) => f.replace(/\.json$/, ''));
}

export function writeJson(relPath, obj) {
  const f = dataDir(relPath);
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, JSON.stringify(obj, null, 2) + '\n');
}

export function readJson(relPath, fallback = null) {
  const f = dataDir(relPath);
  if (!existsSync(f)) return fallback;
  try {
    return JSON.parse(readFileSync(f, 'utf8'));
  } catch {
    return fallback;
  }
}

export const todayIso = () => new Date().toISOString().slice(0, 10);
export { dataDir };
