// Builds data/series/index.json — the contract every consumer reads.
//
// This lives in its own module because more than one script adds history to the
// store: the hourly collector and the one-time archive backfill. When the
// backfill carried its own copy of this logic it used the wrong relative path,
// no-op'd silently, and left every point count in the catalogue stale while the
// series files on disk were correct.
import { SERIES, ZONES, COMPARISONS } from '../registry.mjs';
import { readSeries, writeJson } from './util.mjs';

/** Map a 0-100 sentiment score onto its named zone band. */
export function zoneFor(score) {
  if (score == null) return null;
  const z = ZONES.find((b) => score < b.lt) ?? ZONES[ZONES.length - 1];
  return { label: z.label, color: z.color };
}

/**
 * Rebuild the catalogue from what is currently on disk.
 *
 * Returns the catalogue and the ids that have no stored points, so callers can
 * report which declared series are still empty rather than pretending the
 * registry and the data agree.
 */
export function rebuildCatalogue({ incoming = null } = {}) {
  const catalogue = [];
  const unavailable = [];

  for (const meta of SERIES) {
    // In dry-run mode nothing has been written yet, so the only available source
    // of truth is what this run collected in memory.
    const stored = incoming ? { points: incoming[meta.id] ?? [] } : readSeries(meta.id);
    if (!stored.points?.length) {
      unavailable.push(meta.id);
      continue;
    }
    const last = stored.points[stored.points.length - 1];
    catalogue.push({
      ...meta,
      points: stored.points.length,
      first: stored.points[0][0],
      last: last[0],
      lastValue: last[1],
      zone: meta.kind === 'sentiment' ? zoneFor(last[1]) : null,
    });
  }

  const groups = {};
  for (const s of catalogue) groups[s.group] = (groups[s.group] ?? 0) + 1;

  writeJson('series/index.json', {
    generated: new Date().toISOString(),
    count: catalogue.length,
    declared: SERIES.length,
    groups,
    zones: ZONES.map(({ lt, label, color }) => ({ lt: lt === Infinity ? null : lt, label, color })),
    comparisons: COMPARISONS,
    series: catalogue,
  });

  return { catalogue, unavailable };
}
