// Crypto Fear & Greed (alternative.me).
//
// limit=0 returns the entire history (genesis 2018-02-01) in one request,
// which makes this the deepest series in the whole API and the best candidate
// for long-horizon regime work.
import { fetchJson, toDate, round } from '../lib/util.mjs';

const URL = 'https://api.alternative.me/fng/?limit=0&format=json';

export async function collect() {
  const data = await fetchJson(URL, { headers: { Accept: 'application/json' } });
  const rows = data?.data;
  if (!Array.isArray(rows) || !rows.length) throw new Error('Crypto F&G: empty data array');

  const points = rows
    .map((r) => [toDate(r.timestamp), round(Number(r.value), 4)])
    .filter(([d, v]) => d && v != null && Number.isFinite(v))
    .sort((a, b) => (a[0] < b[0] ? -1 : 1));

  const latest = rows[0];

  return {
    source: 'alternative.me',
    series: { 'crypto-fng': points },
    snapshot: {
      value: round(Number(latest.value), 0),
      classification: latest.value_classification,
      timestamp: toDate(latest.timestamp),
      historyDays: points.length,
    },
  };
}
