// CNN Fear & Greed.
//
// The dataviz endpoint rejects requests that don't look like a browser
// (it returns HTTP 418 "I'm a teapot. You're a bot."), so the full navigation
// header set below is required, not decorative.
//
// History is the whole point of this source. The undated payload hands you a
// single current score plus roughly 250 days of aggregate history, which is not
// enough for a model that wants to learn a regime: one year contains maybe one
// drawdown, so anything trained on it is fitting a single episode. The endpoint
// also accepts a start date (`/graphdata/2020-09-01`) and then returns **daily
// history back to that date for the aggregate index and all nine components**.
//
// The boundary moves and is not documented — asking for too early a date returns
// HTTP 500, not a helpful error — so we probe a descending list of candidate
// starts and take the earliest that answers, rather than hardcoding a date that
// will silently stop working.
import { fetchJson, toDate, round } from '../lib/util.mjs';
import { CNN_COMPONENTS } from '../registry.mjs';

const BASE = 'https://production.dataviz.cnn.io/index/fearandgreed/graphdata';

const HEADERS = {
  Accept: 'application/json, text/plain, */*',
  Origin: 'https://edition.cnn.com',
  Referer: 'https://edition.cnn.com/',
  'sec-ch-ua': '"Chromium";v="126", "Not:A-Brand";v="24"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-site',
};

/**
 * Candidate history starts, earliest first. The first one CNN accepts wins, so
 * the configured value is preferred and the later entries are the escape hatch
 * for when CNN quietly moves the floor forward.
 */
function historyCandidates() {
  const configured = (process.env.CNN_HISTORY_START || '').trim();
  const fallbacks = ['2021-01-01', '2022-01-01', '2023-01-01'];
  return [...new Set([configured || '2020-09-01', ...fallbacks])];
}

/** CNN returns {x: msEpoch, y: value} points. */
const toPoints = (arr) =>
  (arr ?? [])
    .map((p) => [toDate(p.x), round(p.y, 4)])
    .filter(([d, v]) => d && v != null)
    .sort((a, b) => (a[0] < b[0] ? -1 : 1));

/**
 * Fetch the deepest history CNN will serve. Returns the payload plus the start
 * date actually in effect, so the collector can report it and the verifier can
 * notice if the depth ever collapses back to a year.
 */
async function fetchDeepest() {
  const tried = [];
  for (const start of historyCandidates()) {
    try {
      const data = await fetchJson(`${BASE}/${start}`, { headers: HEADERS, tries: 2 });
      const hist = data?.fear_and_greed_historical?.data;
      if (!hist?.length) throw new Error('no historical array in response');
      return { data, start, tried };
    } catch (e) {
      tried.push(`${start}: ${e.message}`);
    }
  }
  throw new Error(`CNN: no start date accepted. Tried -> ${tried.join(' | ')}`);
}

export async function collect() {
  const { data, start, tried } = await fetchDeepest();
  const fng = data?.fear_and_greed;
  if (!fng || typeof fng.score !== 'number') {
    throw new Error('CNN: fear_and_greed.score missing - response shape changed');
  }

  const series = {};
  const seriesPoints = (id, points) => {
    if (points.length) series[id] = points;
  };

  // ---- aggregate index ---------------------------------------------------
  const aggPoints = toPoints(data.fear_and_greed_historical?.data);
  if (aggPoints.length < 100) {
    throw new Error(
      `CNN: only ${aggPoints.length} history points returned (expected daily history). ` +
        `Check whether the dated endpoint changed shape.`,
    );
  }
  // The live score is authoritative for today even if the history array lags.
  const today = toDate(fng.timestamp) ?? new Date().toISOString().slice(0, 10);
  series['cnn-fng'] = [...aggPoints.filter((p) => p[0] !== today), [today, round(fng.score, 4)]]
    .filter((p) => p[1] != null)
    .sort((a, b) => (a[0] < b[0] ? -1 : 1));

  // ---- nine components ---------------------------------------------------
  // Same dated payload carries full-depth component history, so no extra calls.
  const componentDepths = {};
  for (const c of CNN_COMPONENTS) {
    const pts = toPoints(data[c.key]?.data);
    componentDepths[c.slug] = pts.length;
    seriesPoints(c.slug, pts);
  }

  const first = series['cnn-fng'][0][0];
  const last = series['cnn-fng'][series['cnn-fng'].length - 1][0];

  return {
    source: 'cnn',
    series,
    snapshot: {
      value: round(fng.score, 2),
      rating: fng.rating,
      timestamp: fng.timestamp,
      previousClose: round(fng.previous_close, 2),
      previous1Week: round(fng.previous_1_week, 2),
      previous1Month: round(fng.previous_1_month, 2),
      previous1Year: round(fng.previous_1_year, 2),
      historyDays: series['cnn-fng'].length,
      historyStart: start,
      historyFrom: first,
      historyTo: last,
      probeFailures: tried.length ? tried : undefined,
      componentDepths,
    },
  };
}
