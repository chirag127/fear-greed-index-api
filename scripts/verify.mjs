// Validates the emitted API. Exits non-zero on any failure so CI catches a
// silently broken collector. This is the test that would have caught the old
// scraper recording CSS hex fragments.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { SERIES, SERIES_BY_ID, ZONES } from './registry.mjs';

const root = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const read = (p) => JSON.parse(readFileSync(root + p, 'utf8'));

const failures = [];
const warnings = [];
const check = (cond, msg) => {
  if (!cond) failures.push(msg);
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ---------- index.json ----------
check(existsSync(root + 'data/series/index.json'), 'data/series/index.json is missing');
const index = read('data/series/index.json');

check(index.count > 0, 'index.json reports zero series');
check(Array.isArray(index.series) && index.series.length === index.count, 'index.count does not match series array length');
check(index.zones?.length >= 5, 'index.json is missing sentiment zone bands');
check(Array.isArray(index.comparisons) && index.comparisons.length > 0, 'index.json declares no comparison groups');

// Every comparison must reference series that actually exist.
const have = new Set(index.series.map((s) => s.id));
for (const c of index.comparisons ?? []) {
  for (const id of c.ids ?? []) check(have.has(id), `comparison "${c.id}" references unknown series "${id}"`);
  check((c.ids ?? []).length >= 2, `comparison "${c.id}" needs at least two series`);
}

// ---------- per-series files ----------
const filesOnDisk = readdirSync(root + 'data/series')
  .filter((f) => f.endsWith('.json') && f !== 'index.json')
  .map((f) => f.replace(/\.json$/, ''));

for (const id of filesOnDisk) {
  check(SERIES_BY_ID.has(id), `orphan series file on disk not declared in registry: ${id}`);
}
for (const s of index.series) {
  check(SERIES_BY_ID.has(s.id), `index.json lists undeclared series: ${s.id}`);
  check(filesOnDisk.includes(s.id), `index.json lists "${s.id}" but data/series/${s.id}.json is missing`);
}

let totalPoints = 0;
let newest = '0000-00-00';
for (const s of index.series) {
  if (!filesOnDisk.includes(s.id)) continue;
  const file = read(`data/series/${s.id}.json`);
  const pts = file.points ?? [];
  totalPoints += pts.length;

  check(pts.length > 0, `${s.id}: file has no points`);
  check(pts.length === s.points, `${s.id}: index.json says ${s.points} points, file has ${pts.length}`);

  let prev = '';
  for (const p of pts) {
    check(Array.isArray(p) && p.length === 2, `${s.id}: malformed point ${JSON.stringify(p)}`);
    if (!Array.isArray(p) || p.length !== 2) continue;
    const [d, v] = p;
    check(DATE_RE.test(String(d)), `${s.id}: bad date "${d}"`);
    check(Number.isFinite(v), `${s.id}: non-finite value "${v}" on ${d}`);
    check(String(d) > prev, `${s.id}: points not strictly ascending at ${d}`);
    prev = String(d);
  }

  if (pts.length) {
    const [lastDate, lastValue] = pts[pts.length - 1];
    check(lastValue === s.lastValue, `${s.id}: index lastValue ${s.lastValue} != file ${lastValue}`);
    check(lastDate === s.last, `${s.id}: index last date ${s.last} != file ${lastDate}`);
    if (lastDate > newest) newest = lastDate;

    // Sentiment composites are defined on 0-100. Nothing else is.
    if (s.kind === 'sentiment') {
      check(lastValue >= 0 && lastValue <= 100, `${s.id}: sentiment value ${lastValue} outside 0-100`);
      const zone = ZONES.find((z) => lastValue < z.lt);
      check(!!s.zone && s.zone.label === zone.label, `${s.id}: zone "${s.zone?.label}" wrong for ${lastValue}`);
    }
  }
}

check(totalPoints > 3000, `only ${totalPoints} total points - expected the crypto F&G history alone to exceed this`);

// ---------- latest.json ----------
check(existsSync(root + 'data/latest.json'), 'data/latest.json is missing');
const latest = read('data/latest.json');
check(latest.updated, 'latest.json has no updated timestamp');
check(latest.headline && Object.keys(latest.headline).length >= 4, 'latest.json headline is missing entries');
for (const k of ['mmi', 'cnn-fng', 'crypto-fng', 'india-vix']) {
  check(latest.headline?.[k]?.value != null, `latest.json headline.${k}.value missing`);
}
for (const [name, st] of Object.entries(latest.sources ?? {})) {
  if (!st.ok) warnings.push(`source "${name}" failed this run: ${st.error}`);
}

// ---------- freshness ----------
const ageDays = Math.round((Date.now() - new Date(newest + 'T00:00:00Z').getTime()) / 86400000);
check(ageDays <= 5, `data is stale: newest point ${newest} is ${ageDays} days old`);
if (ageDays > 1) warnings.push(`newest point is ${ageDays} days old (weekend/holiday?)`);

// ---------- report ----------
console.log(`verified ${index.count} series, ${totalPoints} points, newest ${newest} (${ageDays}d ago)`);
if (warnings.length) {
  console.log('\nwarnings:');
  for (const w of warnings) console.log('  ! ' + w);
}
if (failures.length) {
  console.error(`\n${failures.length} FAILURE(S):`);
  for (const f of failures) console.error('  x ' + f);
  process.exit(1);
}
console.log('all checks passed');
