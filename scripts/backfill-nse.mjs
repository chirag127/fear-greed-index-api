// One-time historical backfill of Indian valuation from NSE's daily archive.
//
// The live `allIndices` endpoint only ever answers "what is today's P/E", so a
// fresh collector produces valuation series with a single observation. Those
// cannot be used as features — no percentile, no z-score, no regime — and they
// make the comparative valuation charts empty. NSE has published a daily CSV of
// every index with P/E, P/B and dividend yield for years, and this script walks
// it backwards.
//
// This is deliberately NOT part of the hourly collector: it issues ~2,500
// requests. Run it once (or when extending the range), and let the normal
// collector maintain the recent tail. Parsed results are cached on disk, so a
// re-run only fetches what is missing and a network failure is resumable.
//
//   node scripts/backfill-nse.mjs --from=2016-09-01
//   node scripts/backfill-nse.mjs --from=2020-01-01 --concurrency=8
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { UA, round, readSeries, writeSeries, mergePoints, dataDir } from './lib/util.mjs';
import { rebuildCatalogue } from './lib/catalogue.mjs';
import { NSE_ARCHIVE_INDICES, NSE_ARCHIVE_SECTORS, archiveKey } from './registry.mjs';

const ARCHIVE = 'https://archives.nseindia.com/content/indices';
const CACHE = dataDir('../.cache/nse-archive');

const arg = (name, dflt) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};
const flag = (name) => process.argv.includes(`--${name}`);

const FROM = arg('from', '2016-09-01');
const TO = arg('to', new Date().toISOString().slice(0, 10));
const CONCURRENCY = Math.max(1, Math.min(12, Number(arg('concurrency', '6')) || 6));

/** Minimal quote-aware CSV splitter; NSE has emitted quoted cells in the past. */
function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else quoted = false;
      } else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

const num = (v) => {
  if (v == null) return null;
  const n = Number(String(v).replace(/,/g, '').trim());
  return Number.isFinite(n) ? round(n, 4) : null;
};

/** Map of normalised index name -> our slug, plus which column feeds which series. */
const NAME_TO_SLUG = new Map();
for (const { csv, slug } of NSE_ARCHIVE_INDICES) NAME_TO_SLUG.set(archiveKey(csv), { slug, suffix: '' });
for (const { csv, slug } of NSE_ARCHIVE_SECTORS) NAME_TO_SLUG.set(archiveKey(csv), { slug, suffix: 'sector-', peOnly: true });

/** Column headers we depend on, matched case-insensitively. */
const COLUMNS = {
  name: 'index name',
  close: 'closing index value',
  pe: 'p/e',
  pb: 'p/b',
  dy: 'div yield',
};

/**
 * Extract the values we care about from one day's archive CSV.
 * Returns null when the file has no usable rows (holiday files sometimes exist
 * but carry only a header).
 */
function extract(csv) {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return null;

  const header = parseCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const at = {};
  for (const [key, label] of Object.entries(COLUMNS)) {
    const i = header.indexOf(label);
    if (i === -1) return null; // shape changed - let the caller report it
    at[key] = i;
  }

  const found = { pe: {}, pb: {}, dy: {}, close: {} };
  let matched = 0;
  for (const line of lines.slice(1)) {
    const cells = parseCsvLine(line);
    const mapped = NAME_TO_SLUG.get(archiveKey(cells[at.name]));
    if (!mapped) continue;
    matched++;
    const { slug, suffix, peOnly } = mapped;
    const put = (bag, id, v) => {
      if (v != null) bag[`${suffix}${slug}-${id}`] = v;
    };
    put(found.pe, 'pe', num(cells[at.pe]));
    if (!peOnly) {
      put(found.pb, 'pb', num(cells[at.pb]));
      put(found.dy, 'dy', num(cells[at.dy]));
      put(found.close, 'level', num(cells[at.close]));
    }
  }
  return matched ? found : null;
}

/** Fetch one archive file. 404 is a definitive "not a trading day", not an error. */
async function fetchDay(date) {
  const [y, m, d] = date.split('-');
  const url = `${ARCHIVE}/ind_close_all_${d}${m}${y}.csv`;
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Referer: 'https://www.nseindia.com/', Accept: 'text/csv,*/*' },
    signal: AbortSignal.timeout(25000),
  }).catch((e) => ({ ok: false, status: 0, statusText: e.message }));

  if (res.status === 404) return { date, empty: true };
  if (!res.ok) throw new Error(`HTTP ${res.status || res.statusText}`);
  return { date, values: extract(await res.text()) };
}

/** Reject non-trading weekdays early; the archive has no file for weekends. */
const isWeekend = (date) => {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
  return dow === 0 || dow === 6;
};

function dateRange(from, to) {
  const out = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86400000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

function cachePath(date) {
  const f = `${CACHE}/${date}.json`;
  mkdirSync(dirname(f), { recursive: true });
  return f;
}

function readCache(date) {
  const f = cachePath(date);
  if (!existsSync(f)) return null;
  try {
    return JSON.parse(readFileSync(f, 'utf8'));
  } catch {
    return null;
  }
}

function writeCache(date, payload) {
  writeFileSync(cachePath(date), JSON.stringify(payload));
}

async function main() {
  const dates = dateRange(FROM, TO).filter((d) => !isWeekend(d));
  console.log(`backfilling ${dates.length} weekdays ${FROM} -> ${TO} (concurrency ${CONCURRENCY})`);

  const collected = { pe: {}, pb: {}, dy: {}, close: {} };
  let fetched = 0;
  let cached = 0;
  let empty = 0;
  let failed = 0;
  const failures = [];
  const shapeWarnings = [];

  const queue = [...dates];
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length) {
      const date = queue.shift();
      let payload = readCache(date);
      if (payload) cached++;
      else {
        try {
          payload = await fetchDay(date);
          // Retry once on transient failure before giving up, so a flaky request
          // doesn't leave a permanent hole in the middle of the series.
          if (!payload.empty && !payload.values) {
            await new Promise((r) => setTimeout(r, 500));
            payload = await fetchDay(date);
          }
          writeCache(date, payload);
          fetched++;
        } catch (e) {
          failed++;
          failures.push(`${date}: ${e.message}`);
          continue;
        }
      }
      if (payload.empty || !payload.values) {
        empty++;
        continue;
      }
      for (const bag of Object.keys(collected)) {
        for (const [id, v] of Object.entries(payload.values[bag] ?? {})) {
          (collected[bag][id] ??= []).push([date, v]);
        }
      }
      if (!payload.values.pe && shapeWarnings.length < 3) shapeWarnings.push(date);
    }
  });
  await Promise.all(workers);

  if (shapeWarnings.length) {
    console.warn(`WARNING: ${shapeWarnings.length}+ files parsed but matched no known index ` +
      `(e.g. ${shapeWarnings.join(', ')}). Check the CSV column names.`);
  }

  // Merge into the store, keeping any values the live collector already wrote.
  let seriesWritten = 0;
  let pointsAdded = 0;
  const skipWrite = flag('dry-run');
  for (const bag of Object.keys(collected)) {
    for (const [id, points] of Object.entries(collected[bag])) {
      if (!points.length) continue;
      const before = readSeries(id).points.length;
      const merged = mergePoints(readSeries(id).points, points);
      if (!skipWrite) writeSeries(id, merged);
      seriesWritten++;
      pointsAdded += merged.length - before;
      if (!skipWrite) pruneStale(id, merged);
    }
  }

  console.log(
    `done: fetched=${fetched} cached=${cached} no-data=${empty} failed=${failed}\n` +
      `      series=${seriesWritten} points_added=${pointsAdded}${skipWrite ? ' (dry run, not written)' : ''}`,
  );
  if (failures.length) {
    console.log(`      ${failures.length} request(s) failed, e.g. ${failures.slice(0, 5).join(' | ')}`);
    console.log('      re-run the same command to retry only the missing dates');
  }
  if (skipWrite) return;

  refreshCatalogue();
}

/**
 * Remove points that fall on dates we authoritatively know were not trading days.
 * Without this, a single mis-parsed file leaves a Saturday value that makes the
 * verifier and every chart flip between odd and even spacing.
 */
function pruneStale(id, points) {
  const bad = points.filter(([d]) => isWeekend(d));
  if (!bad.length) return;
  writeSeries(id, points.filter(([d]) => !isWeekend(d)));
  console.log(`      pruned ${bad.length} weekend point(s) from ${id}`);
}

/**
 * Regenerate the catalogue so the dashboard reflects the deeper history
 * immediately rather than after the next live collection. Shares its
 * implementation with the collector: a second copy of this logic is exactly how
 * the counts went stale in the first place.
 */
function refreshCatalogue() {
  const { catalogue, unavailable } = rebuildCatalogue();
  const total = catalogue.reduce((a, s) => a + s.points, 0);
  console.log(`      catalogue refreshed: ${catalogue.length} series, ${total} points`);
  if (unavailable.length) {
    console.log(`      still empty (no history anywhere yet): ${unavailable.join(', ')}`);
  }
}

main().catch((e) => {
  console.error('backfill failed:', e);
  process.exit(1);
});
