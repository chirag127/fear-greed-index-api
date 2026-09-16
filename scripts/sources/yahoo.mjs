// Yahoo Finance chart API — used purely for HISTORY.
//
// NSE's allIndices gives us today's level and today's valuation, but nothing
// about the past, so every NSE-derived series would start with a single point
// and stay near-empty for months. Yahoo supplies ~10 years of daily closes for
// the headline indices and India VIX, which is enough for the dashboard's
// event-study and lead-lag analytics to mean something on day one.
//
// This source only ever *backfills*. NSE remains authoritative for the current
// day: collect.mjs runs Yahoo before NSE, and the series store lets later
// writes win, so today's NSE close overwrites Yahoo's.
import { fetchJson, toDate, round } from '../lib/util.mjs';

const BASE = 'https://query1.finance.yahoo.com/v8/finance/chart';

/**
 * Symbols that resolve to real, deep history.
 *
 * Several plausible-looking sector symbols (^CNXAUTO, ^CNXMETAL, ^CNXFMCG,
 * ^CNXENERGY, ^CNXREALTY, ^CNXFIN) return HTTP 200 with a single stale point
 * rather than 404, so a status check alone is not enough — see MIN_POINTS.
 */
const SYMBOLS = [
  { symbol: '^NSEI', series: 'nifty50-level', label: 'NIFTY 50' },
  { symbol: '^NSEBANK', series: 'nifty-bank-level', label: 'NIFTY BANK' },
  { symbol: '^CNXIT', series: 'sector-it-level', label: 'NIFTY IT' },
  { symbol: '^CNX100', series: 'nifty100-level', label: 'NIFTY 100' },
  // ^CNX500 returns 404; ^CRSLDX is the Nifty 500 total-return alias Yahoo maps.
  { symbol: '^CRSLDX', series: 'nifty500-level', label: 'NIFTY 500' },
  { symbol: '^INDIAVIX', series: 'india-vix', label: 'INDIA VIX' },
  { symbol: '^BSESN', series: 'sensex-level', label: 'S&P BSE SENSEX' },
];

/** Below this depth we treat the response as a dead/stale symbol, not history. */
const MIN_POINTS = 30;

async function fetchSymbol({ symbol, series, label }) {
  const url = `${BASE}/${encodeURIComponent(symbol)}?range=10y&interval=1d`;
  const json = await fetchJson(url, {
    headers: { Accept: 'application/json', Referer: 'https://finance.yahoo.com/' },
    tries: 2,
  });

  const result = json?.chart?.result?.[0];
  if (!result?.timestamp?.length) throw new Error(`${symbol}: no timestamps`);

  // `quote.close` contains nulls for holidays and halts; drop them.
  const closes = result.indicators?.quote?.[0]?.close ?? [];
  const points = [];
  for (let i = 0; i < result.timestamp.length; i++) {
    const v = closes[i];
    if (v == null || !Number.isFinite(v)) continue;
    const d = toDate(result.timestamp[i]);
    if (d) points.push([d, round(v, 4)]);
  }

  if (points.length < MIN_POINTS) {
    throw new Error(`${symbol}: only ${points.length} usable points (stale symbol?)`);
  }
  return { series, label, points: points.sort((a, b) => (a[0] < b[0] ? -1 : 1)) };
}

export async function collect() {
  const results = await Promise.allSettled(SYMBOLS.map(fetchSymbol));

  const series = {};
  const snapshot = { symbols: {}, skipped: [] };

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const spec = SYMBOLS[i];
    if (r.status === 'rejected') {
      snapshot.skipped.push({ symbol: spec.symbol, reason: r.reason?.message ?? 'failed' });
      continue;
    }
    series[r.value.series] = r.value.points;
    snapshot.symbols[spec.series] = {
      symbol: spec.symbol,
      label: spec.label,
      points: r.value.points.length,
      first: r.value.points[0][0],
      last: r.value.points[r.value.points.length - 1][0],
      lastClose: r.value.points[r.value.points.length - 1][1],
    };
  }

  const got = Object.keys(series).length;
  if (!got) throw new Error('Yahoo: every symbol failed');
  return { source: 'yahoo', series, snapshot };
}
