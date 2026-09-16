// NSE: index valuation/breadth from allIndices, plus FII/DII cash-market flows.
//
// allIndices is a single request that carries last / pe / pb / dy / advances /
// declines / unchanged for all 139 published indices, so one call feeds the
// entire valuation and breadth section of the API.
import { fetchNseJson, toDate, round, readSeries, listSeries } from '../lib/util.mjs';
import { NSE_INDICES, NSE_SECTORS } from '../registry.mjs';

export async function collect() {
  const series = {};
  const snapshot = { indices: {}, flows: null, breadth: {} };

  const payload = await fetchNseJson('/api/allIndices');
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  if (!rows.length) throw new Error('NSE allIndices returned no rows');

  // NSE stamps the whole payload with one date; grab it off any F&O-eligible row.
  const asOn = toDate(rows.find((r) => r.previousDay)?.previousDay) ?? new Date().toISOString().slice(0, 10);

  const byName = new Map(rows.map((r) => [String(r.index).toUpperCase(), r]));

  const num = (v) => (v === undefined || v === null || v === '' ? null : Number(v));

  for (const { slug, name } of NSE_INDICES) {
    const row = byName.get(name.toUpperCase());
    if (!row) continue;

    for (const [field, key] of [['pe', 'pe'], ['pb', 'pb'], ['dy', 'dy']]) {
      const v = num(row[field]);
      if (v != null && Number.isFinite(v)) series[`${slug}-${key}`] = [[asOn, round(v, 4)]];
    }
    const last = num(row.last);
    if (last != null) series[`${slug}-level`] = [[asOn, round(last, 4)]];

    const adv = num(row.advances);
    const dec = num(row.declines);
    const unch = num(row.unchanged) ?? 0;
    if (adv != null && dec != null) {
      series[`${slug}-ad-net`] = [[asOn, round(adv - dec, 4)]];
      const denom = adv + dec + unch;
      if (denom > 0) series[`${slug}-ad-ratio`] = [[asOn, round(adv / denom, 6)]];
    }

    snapshot.indices[slug] = {
      name: row.index,
      level: round(last, 2),
      changePct: round(num(row.percentChange), 2),
      pe: round(num(row.pe), 2),
      pb: round(num(row.pb), 2),
      dy: round(num(row.dy), 2),
      advances: adv,
      declines: dec,
      yearHigh: round(num(row.yearHigh), 2),
      yearLow: round(num(row.yearLow), 2),
      pctFromYearHigh: num(row.yearHigh) ? round(((last - num(row.yearHigh)) / num(row.yearHigh)) * 100, 2) : null,
    };
    if (adv != null && dec != null) {
      snapshot.breadth[slug] = {
        advances: adv,
        declines: dec,
        unchanged: num(row.unchanged),
        net: round(adv - dec, 0),
        ratio: adv + dec > 0 ? round(adv / (adv + dec), 3) : null,
      };
    }
  }

  const vix = byName.get('INDIA VIX');
  if (vix) {
    const v = num(vix.last);
    if (v != null) series['india-vix'] = [[asOn, round(v, 4)]];
    snapshot.vix = round(v, 2);
  }

  // Sector P/E — valuation rotation.
  for (const { slug, name } of NSE_SECTORS) {
    const row = byName.get(name.toUpperCase());
    const v = num(row?.pe);
    if (v != null && Number.isFinite(v)) series[`sector-${slug}-pe`] = [[asOn, round(v, 4)]];
  }

  // FII/DII cash-market flows.
  try {
    const flows = await fetchNseJson('/api/fiidiiTradeReact');
    if (Array.isArray(flows)) {
      for (const row of flows) {
        const d = toDate(row.date);
        const net = num(row.netValue);
        if (!d || net == null) continue;
        const cat = String(row.category ?? '').toUpperCase();
        if (cat.startsWith('FII')) series['fii-net'] = [[d, round(net, 4)]];
        else if (cat === 'DII') series['dii-net'] = [[d, round(net, 4)]];
      }
      snapshot.flows = {
        date: toDate(flows[0]?.date),
        rows: flows.map((r) => ({
          category: r.category,
          date: toDate(r.date),
          buy: round(num(r.buyValue), 2),
          sell: round(num(r.sellValue), 2),
          net: round(num(r.netValue), 2),
        })),
      };
    }
  } catch (e) {
    console.error('NSE flows failed (non-fatal):', e.message);
  }

  return { source: 'nse', series, snapshot, asOn };
}

/**
 * Cumulative flow series are derived from whatever daily history we have on
 * disk, so they must be rebuilt after the daily points are merged, not before.
 */
export function deriveFlowCumulatives() {
  const out = {};
  for (const [daily, cum] of [['fii-net', 'fii-net-cum'], ['dii-net', 'dii-net-cum']]) {
    if (!listSeries().includes(daily)) continue;
    const points = readSeries(daily).points;
    let running = 0;
    out[cum] = points.map(([d, v]) => {
      running += Number(v);
      return [d, round(running, 4)];
    });
  }
  return out;
}
