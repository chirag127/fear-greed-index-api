// Collector entrypoint. Runs every source, merges into the git-as-DB series
// store, then emits the two files consumers actually read:
//
//   data/series/index.json  -> catalogue + per-series metadata (the contract)
//   data/latest.json        -> current snapshot for the hero / homepage
//
// A single failing upstream never fails the run: last-known-good data stays
// untouched and the failure is reported in latest.json. Only a total wipeout
// exits non-zero, so CI can alert on real breakage instead of flapping.
import { collect as tickertape } from './sources/tickertape.mjs';
import { collect as nse, deriveFlowCumulatives } from './sources/nse.mjs';
import { collect as cnn } from './sources/cnn.mjs';
import { collect as crypto } from './sources/crypto.mjs';
import { collect as yahoo } from './sources/yahoo.mjs';
import { SERIES, SERIES_BY_ID } from './registry.mjs';
import { mergePoints, readSeries, writeSeries, writeJson, todayIso, round } from './lib/util.mjs';
import { rebuildCatalogue, zoneFor } from './lib/catalogue.mjs';

// Order matters: later sources win ties on the same date. Yahoo runs first so
// its historical backfill is overwritten by NSE for the current day, which is
// the authoritative source for Indian index levels.
const SOURCES = [
  { name: 'yahoo', fn: yahoo, critical: false },
  { name: 'tickertape', fn: tickertape, critical: true },
  { name: 'nse', fn: nse, critical: true },
  { name: 'cnn', fn: cnn, critical: false },
  { name: 'crypto', fn: crypto, critical: false },
];

export { zoneFor };

async function runSource({ name, fn }) {
  const started = Date.now();
  try {
    const result = await fn();
    return { name, ok: true, ms: Date.now() - started, result };
  } catch (e) {
    console.error(`[${name}] FAILED: ${e.message}`);
    return { name, ok: false, ms: Date.now() - started, error: e.message };
  }
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const runs = await Promise.all(SOURCES.map(runSource));

  const incoming = {};
  const snapshots = {};
  for (const r of runs) {
    if (!r.ok) continue;
    snapshots[r.name] = r.result.snapshot ?? null;
    for (const [id, points] of Object.entries(r.result.series ?? {})) {
      incoming[id] = [...(incoming[id] ?? []), ...points];
    }
  }

  // Derived series must be computed from stored daily history, not from the
  // single fresh observation, or the running sum would reset every run.
  const sourceOk = (n) => runs.some((r) => r.name === n && r.ok);

  // A source emitting an id the registry doesn't declare would be written to
  // disk but stay invisible to every consumer. Surface it instead of hiding it.
  const orphans = Object.keys(incoming).filter((id) => !SERIES_BY_ID.has(id));
  if (orphans.length) {
    console.error(`\nWARNING: ${orphans.length} series not in registry (invisible to consumers): ${orphans.join(', ')}`);
  }

  const written = [];
  for (const [id, points] of Object.entries(incoming)) {
    if (dryRun) {
      written.push({ id, count: points.length });
      continue;
    }
    const merged = mergePoints(readSeries(id).points, points);
    writeSeries(id, merged);
    written.push({ id, count: merged.length, added: points.length });
  }

  // Cumulative flows are rebuilt from the freshly persisted daily series.
  if (!dryRun && (sourceOk('nse') || incoming['fii-net'] || incoming['dii-net'])) {
    for (const [id, points] of Object.entries(deriveFlowCumulatives())) {
      writeSeries(id, points);
      written.push({ id, count: points.length, derived: true });
    }
  }

  // ---- catalogue -------------------------------------------------------
  const { catalogue, unavailable } = rebuildCatalogue({ incoming: dryRun ? incoming : null });

  // ---- snapshot --------------------------------------------------------
  // Some sources publish their own reference points, and one of them has to:
  // Tickertape exposes no MMI history, so `mmi` cannot supply a prior value from
  // its own series until two days have accumulated. Without this fallback the
  // flagship card reads "prev -" on every fresh install and silently hides the
  // day's move - which, on a day the index collapses, is the whole story.
  const PREV_FALLBACK = {
    mmi: () => snapshots.tickertape?.lastDay?.value ?? null,
  };

  const headline = {};
  for (const id of ['mmi', 'cnn-fng', 'crypto-fng', 'india-vix']) {
    const meta = SERIES_BY_ID.get(id);
    const entry = catalogue.find((c) => c.id === id);
    if (!meta || !entry) continue;
    const fromSeries = entry.points > 1 ? catalogueSeriesPrev(id) : null;
    headline[id] = {
      title: meta.title,
      short: meta.short,
      value: entry.lastValue,
      date: entry.last,
      zone: entry.zone,
      previous: fromSeries ?? PREV_FALLBACK[id]?.() ?? null,
    };
  }

  const asOf =
    snapshots.nse?.flows?.date ??
    snapshots.tickertape?.date ??
    todayIso();

  writeJson('latest.json', {
    updated: new Date().toISOString(),
    asOf,
    headline,
    tickertape: snapshots.tickertape ?? null,
    cnn: snapshots.cnn ?? null,
    crypto: snapshots.crypto ?? null,
    nse: snapshots.nse ?? null,
    sources: Object.fromEntries(runs.map((r) => [r.name, r.ok ? { ok: true, ms: r.ms } : { ok: false, error: r.error }])),
    unavailable,
    seriesCount: catalogue.length,
  });

  // ---- summary ---------------------------------------------------------
  console.log(`\ncollected ${catalogue.length}/${SERIES.length} series`);
  for (const r of runs) {
    console.log(`  ${r.ok ? 'ok  ' : 'FAIL'} ${r.name.padEnd(11)} ${r.ms}ms${r.ok ? '' : ' :: ' + r.error}`);
  }
  if (unavailable.length) console.log(`  unavailable: ${unavailable.join(', ')}`);

  const criticalDown = runs.filter((r) => SOURCES.find((s) => s.name === r.name)?.critical && !r.ok);
  if (criticalDown.length === SOURCES.filter((s) => s.critical).length) {
    console.error('\nAll critical sources failed - nothing was refreshed.');
    process.exit(1);
  }
  console.log(asOf ? `as-of ${asOf}` : '');
}

function catalogueSeriesPrev(id) {
  const p = readSeries(id).points;
  return p.length > 1 ? p[p.length - 2][1] : null;
}

export { main, round };
if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}` || process.argv[1]?.endsWith('collect.mjs')) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
