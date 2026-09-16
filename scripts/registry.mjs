// The registry is the contract between this data API and any consumer.
// Every series the collector can emit is declared here, with enough metadata
// for a charting layer to render it without hardcoding anything per-series.

export const ZONES = [
  { lt: 25, label: 'Extreme Fear', color: '#c0392b' },
  { lt: 45, label: 'Fear', color: '#e67e22' },
  { lt: 55, label: 'Neutral', color: '#95a5a6' },
  { lt: 75, label: 'Greed', color: '#27ae60' },
  { lt: Infinity, label: 'Extreme Greed', color: '#16a085' },
];

/** NSE index names we pull valuation + breadth from, keyed by our series slug. */
export const NSE_INDICES = [
  { slug: 'nifty50', name: 'NIFTY 50' },
  { slug: 'nifty100', name: 'NIFTY 100' },
  { slug: 'nifty500', name: 'NIFTY 500' },
  { slug: 'nifty-next50', name: 'NIFTY NEXT 50' },
  { slug: 'nifty-bank', name: 'NIFTY BANK' },
  { slug: 'nifty-midcap100', name: 'NIFTY MIDCAP 100' },
  { slug: 'nifty-midcap150', name: 'NIFTY MIDCAP 150' },
  { slug: 'nifty-smallcap100', name: 'NIFTY SMALLCAP 100' },
  { slug: 'nifty-smallcap250', name: 'NIFTY SMALLCAP 250' },
];

/** Sector indices — PE only; these give the valuation-rotation view. */
export const NSE_SECTORS = [
  { slug: 'it', name: 'NIFTY IT' },
  { slug: 'auto', name: 'NIFTY AUTO' },
  { slug: 'fmcg', name: 'NIFTY FMCG' },
  { slug: 'metal', name: 'NIFTY METAL' },
  { slug: 'pharma', name: 'NIFTY PHARMA' },
  { slug: 'realty', name: 'NIFTY REALTY' },
  { slug: 'energy', name: 'NIFTY ENERGY' },
  { slug: 'fin-services', name: 'NIFTY FINANCIAL SERVICES' },
];

/**
 * NSE's daily archive CSV (`ind_close_all_DDMMYYYY.csv`) is the only free source
 * of *historical* Indian valuation. The live `allIndices` endpoint returns just
 * today's P/E, P/B and dividend yield, which is useless for a model: a valuation
 * series with one observation has no percentile, no z-score and no regime.
 *
 * Names are matched case-insensitively against the CSV's "Index Name" column,
 * because NSE is inconsistent about casing between files ('Nifty Midcap 100' in
 * one year, 'NIFTY Midcap 100' in another) and an exact match would silently
 * drop those rows. Matching is on the whole normalised name, never a substring,
 * so 'Nifty Financial Services' cannot be confused with
 * 'Nifty Financial Services 25/50'.
 */
export const NSE_ARCHIVE_INDICES = [
  { csv: 'Nifty 50', slug: 'nifty50' },
  { csv: 'Nifty Next 50', slug: 'nifty-next50' },
  { csv: 'Nifty 100', slug: 'nifty100' },
  { csv: 'Nifty 500', slug: 'nifty500' },
  { csv: 'Nifty Bank', slug: 'nifty-bank' },
  { csv: 'Nifty Midcap 100', slug: 'nifty-midcap100' },
  { csv: 'Nifty Midcap 150', slug: 'nifty-midcap150' },
  { csv: 'Nifty Smallcap 100', slug: 'nifty-smallcap100' },
  { csv: 'Nifty Smallcap 250', slug: 'nifty-smallcap250' },
];

export const NSE_ARCHIVE_SECTORS = [
  { csv: 'Nifty IT', slug: 'it' },
  { csv: 'Nifty Auto', slug: 'auto' },
  { csv: 'Nifty FMCG', slug: 'fmcg' },
  { csv: 'Nifty Metal', slug: 'metal' },
  { csv: 'Nifty Pharma', slug: 'pharma' },
  { csv: 'Nifty Realty', slug: 'realty' },
  { csv: 'Nifty Energy', slug: 'energy' },
  { csv: 'Nifty Financial Services', slug: 'fin-services' },
];

/** Case/whitespace-insensitive key for matching an index name from a CSV row. */
export const archiveKey = (name) => String(name ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/** CNN's graphdata payload exposes the index plus nine sub-indicators. */
export const CNN_COMPONENTS = [
  { key: 'market_momentum_sp500', slug: 'cnn-momentum-sp500', label: 'S&P 500 Momentum', unit: 'level' },
  { key: 'market_momentum_sp125', slug: 'cnn-momentum-sp125', label: 'S&P 125-Day Momentum', unit: 'level' },
  { key: 'stock_price_strength', slug: 'cnn-price-strength', label: 'Stock Price Strength', unit: 'count' },
  { key: 'stock_price_breadth', slug: 'cnn-price-breadth', label: 'Stock Price Breadth', unit: 'count' },
  { key: 'put_call_options', slug: 'cnn-put-call', label: 'Put/Call Options', unit: 'ratio' },
  { key: 'market_volatility_vix', slug: 'cnn-vix', label: 'Market Volatility (VIX)', unit: 'level' },
  { key: 'market_volatility_vix_50', slug: 'cnn-vix50', label: 'VIX 50-Day Average', unit: 'level' },
  { key: 'junk_bond_demand', slug: 'cnn-junk-bond', label: 'Junk Bond Demand', unit: 'ratio' },
  { key: 'safe_haven_demand', slug: 'cnn-safe-haven', label: 'Safe Haven Demand', unit: 'ratio' },
];

const S = (o) => o;

/**
 * Every emitted series. `kind` drives default chart treatment:
 *   sentiment -> 0-100 gauge with zone bands
 *   line      -> plain time series
 */
export const SERIES = [
  // ---------- India sentiment ----------
  S({ id: 'mmi', title: 'Tickertape Market Mood Index', short: 'MMI', group: 'sentiment', market: 'india',
      kind: 'sentiment', unit: 'index', min: 0, max: 100, decimals: 2, cadence: 'hourly',
      source: 'tickertape.in', sourceUrl: 'https://www.tickertape.in/market-mood-index',
      description: 'India 0-100 fear/greed composite (price, volatility, breadth, flows, valuations).' }),
  S({ id: 'india-vix', title: 'India VIX', short: 'VIX', group: 'volatility', market: 'india',
      kind: 'line', unit: 'level', decimals: 2, cadence: 'daily', invert: true,
      source: 'nseindia.com', sourceUrl: 'https://www.nseindia.com/api/allIndices',
      description: 'Implied 30-day volatility of Nifty options. Spikes mark panic; collapses mark complacency.' }),
  S({ id: 'crypto-fng', title: 'Crypto Fear & Greed Index', short: 'Crypto F&G', group: 'sentiment', market: 'crypto',
      kind: 'sentiment', unit: 'index', min: 0, max: 100, decimals: 0, cadence: 'daily',
      source: 'alternative.me', sourceUrl: 'https://alternative.me/crypto/fear-and-greed-index/',
      description: 'alternative.me crypto sentiment composite. A fast, 24/7 risk-appetite proxy.' }),
  S({ id: 'sensex-level', title: 'S&P BSE Sensex · Index Level', short: 'Sensex', group: 'price', market: 'india',
      kind: 'line', unit: 'level', decimals: 2, cadence: 'daily',
      source: 'finance.yahoo.com', sourceUrl: 'https://finance.yahoo.com/quote/%5EBSESN/',
      description: 'BSE Sensex close, 10 years of daily history. Included for comparison against Nifty 50.' }),
  S({ id: 'sector-it-level', title: 'NIFTY IT · Index Level', short: 'Nifty IT', group: 'price', market: 'india',
      kind: 'line', unit: 'level', decimals: 2, cadence: 'daily', sector: true,
      source: 'finance.yahoo.com', sourceUrl: 'https://finance.yahoo.com/quote/%5ECNXIT/',
      description: 'NIFTY IT index close, 10 years of daily history. A proxy for IT-sector risk appetite.' }),
  S({ id: 'mmi-nifty', title: 'Nifty 50 (Tickertape reference)', short: 'Nifty (MMI)', group: 'price', market: 'india',
      kind: 'line', unit: 'level', decimals: 2, cadence: 'hourly', crossCheck: true,
      source: 'tickertape.in', sourceUrl: 'https://www.tickertape.in/market-mood-index',
      description: "Nifty level from Tickertape's own MMI snapshot, so the index the MMI was computed against lines up exactly with the score." }),

  // ---------- US sentiment (CNN) ----------
  S({ id: 'cnn-fng', title: 'CNN Fear & Greed Index', short: 'CNN F&G', group: 'sentiment', market: 'us',
      kind: 'sentiment', unit: 'index', min: 0, max: 100, decimals: 2, cadence: 'daily',
      source: 'cnn.com', sourceUrl: 'https://edition.cnn.com/markets/fear-and-greed',
      description: 'CNN US equity fear/greed composite, equal-weight across seven indicators.' }),
  // NOTE: CNN's sub-indicators are RAW values, not 0-100 scores. Several are
  // unbounded or negative (S&P momentum ~7600, price strength ~-3.1). Declaring
  // them as `sentiment` would make a chart render a 0-100 gauge over nonsense,
  // so they stay plain lines and carry their own units.
  ...CNN_COMPONENTS.map((c) =>
    S({ id: c.slug, title: `CNN · ${c.label}`, short: c.label, group: 'component', market: 'us',
        kind: 'line', unit: c.unit ?? 'index', decimals: 4, cadence: 'daily', component: true,
        source: 'cnn.com', sourceUrl: 'https://edition.cnn.com/markets/fear-and-greed',
        description: `CNN sub-indicator: ${c.label}. Raw indicator value (not a 0-100 score).` }),
  ),

  // ---------- Valuation: headline indices ----------
  ...NSE_INDICES.flatMap(({ slug, name }) => [
    S({ id: `${slug}-pe`, title: `${name} · P/E`, short: `${name} P/E`, group: 'valuation', market: 'india',
        kind: 'line', unit: 'ratio', decimals: 2, cadence: 'daily', higherIsExpensive: true,
        source: 'nseindia.com', sourceUrl: 'https://www.nseindia.com/api/allIndices',
        description: `Trailing price-to-earnings ratio for ${name}, as published by NSE.` }),
    S({ id: `${slug}-pb`, title: `${name} · P/B`, short: `${name} P/B`, group: 'valuation', market: 'india',
        kind: 'line', unit: 'ratio', decimals: 2, cadence: 'daily', higherIsExpensive: true,
        source: 'nseindia.com', sourceUrl: 'https://www.nseindia.com/api/allIndices',
        description: `Price-to-book ratio for ${name}.` }),
    S({ id: `${slug}-dy`, title: `${name} · Dividend Yield`, short: `${name} DY`, group: 'valuation', market: 'india',
        kind: 'line', unit: 'pct', decimals: 2, cadence: 'daily',
        source: 'nseindia.com', sourceUrl: 'https://www.nseindia.com/api/allIndices',
        description: `Dividend yield for ${name} in percent. High yield often marks value/despair.` }),
    S({ id: `${slug}-level`, title: `${name} · Index Level`, short: `${name}`, group: 'price', market: 'india',
        kind: 'line', unit: 'level', decimals: 2, cadence: 'daily',
        source: 'nseindia.com', sourceUrl: 'https://www.nseindia.com/api/allIndices',
        description: `Closing level of ${name}.` }),
  ]),

  // ---------- Valuation: sectors (PE only) ----------
  ...NSE_SECTORS.map(({ slug, name }) =>
    S({ id: `sector-${slug}-pe`, title: `${name} · P/E`, short: `${name} P/E`, group: 'valuation', market: 'india',
        kind: 'line', unit: 'ratio', decimals: 2, cadence: 'daily', higherIsExpensive: true, sector: true,
        source: 'nseindia.com', sourceUrl: 'https://www.nseindia.com/api/allIndices',
        description: `Trailing P/E for the ${name} sector index — the valuation-rotation view.` }),
  ),

  // ---------- Breadth (derived from NSE advances/declines) ----------
  ...NSE_INDICES.flatMap(({ slug, name }) => [
    S({ id: `${slug}-ad-net`, title: `${name} · Net Advances`, short: `${name} A/D`, group: 'breadth', market: 'india',
        kind: 'line', unit: 'count', decimals: 0, cadence: 'daily',
        source: 'nseindia.com', sourceUrl: 'https://www.nseindia.com/api/allIndices',
        description: `Advances minus declines across ${name} constituents. Breadth thrusts precede trend changes.` }),
    S({ id: `${slug}-ad-ratio`, title: `${name} · Advance/Decline Ratio`, short: `${name} A/D Ratio`, group: 'breadth',
        market: 'india', kind: 'line', unit: 'ratio', decimals: 3, baseline: 1, cadence: 'daily',
        source: 'nseindia.com', sourceUrl: 'https://www.nseindia.com/api/allIndices',
        description: `Advances / (advances + declines) for ${name}. Above 0.5 means broad participation.` }),
  ]),

  // ---------- Flows ----------
  S({ id: 'fii-net', title: 'FII/FPI Net Investment', short: 'FII Net', group: 'flow', market: 'india',
      kind: 'bar', unit: 'crore', decimals: 2, cadence: 'daily',
      source: 'nseindia.com', sourceUrl: 'https://www.nseindia.com/api/fiidiiTradeReact',
      description: 'Foreign institutional net buy/sell in the cash market, in INR crore.' }),
  S({ id: 'dii-net', title: 'DII Net Investment', short: 'DII Net', group: 'flow', market: 'india',
      kind: 'bar', unit: 'crore', decimals: 2, cadence: 'daily',
      source: 'nseindia.com', sourceUrl: 'https://www.nseindia.com/api/fiidiiTradeReact',
      description: 'Domestic institutional net buy/sell in the cash market, in INR crore.' }),
  S({ id: 'fii-net-cum', title: 'FII/FPI Cumulative Net', short: 'FII Cumulative', group: 'flow', market: 'india',
      kind: 'line', unit: 'crore', decimals: 2, cadence: 'daily', derived: true,
      source: 'nseindia.com', sourceUrl: 'https://www.nseindia.com/api/fiidiiTradeReact',
      description: 'Running sum of FII net flows — the persistent-foreign-selling signal.' }),
  S({ id: 'dii-net-cum', title: 'DII Cumulative Net', short: 'DII Cumulative', group: 'flow', market: 'india',
      kind: 'line', unit: 'crore', decimals: 2, cadence: 'daily', derived: true,
      source: 'nseindia.com', sourceUrl: 'https://www.nseindia.com/api/fiidiiTradeReact',
      description: 'Running sum of DII net flows. DIIs often absorb FII selling.' }),
];

export const SERIES_BY_ID = new Map(SERIES.map((s) => [s.id, s]));

/** Comparison groups used by the dashboard's comparative view. */
export const COMPARISONS = [
  {
    id: 'fear-greed-global',
    title: 'Fear & Greed: India vs US vs Crypto',
    description: 'Three independent 0-100 sentiment composites. Divergence marks region-specific stress.',
    ids: ['mmi', 'cnn-fng', 'crypto-fng'],
  },
  {
    id: 'sentiment-vs-volatility',
    title: 'Sentiment vs India VIX',
    description: 'Sentiment and implied volatility should move inversely. Breaks are informative.',
    ids: ['mmi', 'cnn-fng', 'india-vix'],
  },
  {
    id: 'valuation-scale',
    title: 'Nifty Valuation Across Cap Tiers',
    description: 'P/E from large to small cap. A widening smallcap premium flags late-cycle froth.',
    ids: ['nifty50-pe', 'nifty100-pe', 'nifty500-pe', 'nifty-midcap150-pe', 'nifty-smallcap250-pe'],
  },
  {
    id: 'breadth-panel',
    title: 'Market Breadth',
    description: 'Net advances and advance ratios. Breadth diverging from price is the classic warning.',
    ids: ['nifty50-ad-net', 'nifty100-ad-net', 'nifty500-ad-net', 'nifty50-ad-ratio', 'nifty500-ad-ratio'],
  },
  {
    id: 'flows-panel',
    title: 'Institutional Flows',
    description: 'FII vs DII net and cumulative flows in INR crore.',
    ids: ['fii-net', 'dii-net', 'fii-net-cum', 'dii-net-cum'],
  },
  {
    id: 'cnn-breakdown',
    title: 'CNN Component Breakdown',
    // The count and the claim were both wrong: CNN exposes nine sub-indicators,
    // and they are raw values (S&P momentum ~7600, price strength ~-3.1), not
    // 0-100 scores. The registry notes this above; the description contradicted it.
    description: "CNN's nine sub-indicators, plotted as raw values on a shared axis.",
    ids: CNN_COMPONENTS.map((c) => c.slug),
  },
];
