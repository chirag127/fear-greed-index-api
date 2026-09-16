// Tickertape Market Mood Index.
//
// The site is Next.js SSR. The score lives at props.pageProps.nowData in the
// __NEXT_DATA__ blob. Earlier versions of this scraper used a regex against a
// different key name that silently stopped matching and fell through to a
// free-text number guess (which can match CSS hex fragments like "535").
// Parsing the JSON properly is the only safe approach.
import { fetchText, toDate, round } from '../lib/util.mjs';

const PAGE = 'https://www.tickertape.in/market-mood-index';

export async function collect() {
  const html = await fetchText(PAGE, { headers: { Referer: 'https://www.tickertape.in/' } });

  const m = html.match(/<script[^>]+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('Tickertape: __NEXT_DATA__ script not found - page layout changed');

  let data;
  try {
    data = JSON.parse(m[1]);
  } catch {
    throw new Error('Tickertape: __NEXT_DATA__ was not valid JSON');
  }

  const now = data?.props?.pageProps?.nowData;
  if (!now || typeof now.currentValue !== 'number') {
    throw new Error('Tickertape: pageProps.nowData.currentValue missing - parser needs updating');
  }

  const date = toDate(now.date) ?? new Date().toISOString().slice(0, 10);

  return {
    source: 'tickertape',
    series: {
      mmi: [[date, round(now.currentValue, 4)]],
      // NSE publishes the same index levels, but Tickertape's own snapshot is a
      // useful cross-check and gives us the 1d/1w/1m reference points.
      'mmi-nifty': [[date, round(now.nifty, 2)]],
    },
    snapshot: {
      value: round(now.currentValue, 2),
      date,
      indicator: round(now.indicator, 2),
      nifty: round(now.nifty, 2),
      lastDay: now.lastDay
        ? { value: round(now.lastDay.indicator, 2), date: toDate(now.lastDay.date), nifty: round(now.lastDay.nifty, 2) }
        : null,
      lastWeek: now.lastWeek
        ? { value: round(now.lastWeek.indicator, 2), date: toDate(now.lastWeek.date), nifty: round(now.lastWeek.nifty, 2) }
        : null,
      lastMonth: now.lastMonth
        ? { value: round(now.lastMonth.indicator, 2), date: toDate(now.lastMonth.date), nifty: round(now.lastMonth.nifty, 2) }
        : null,
    },
  };
}
