#!/usr/bin/env node
/**
 * Regenerates the data-driven section of README.md from data/latest.json.
 * Emits gauge SVG assets under docs/assets/ so GitHub renders them inline.
 * CI runs this before committing data and before building the Pages site.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const latestPath = join(root, 'data', 'latest.json');
const assetsDir = join(root, 'docs', 'assets');
const BEGIN = '<!-- DATA:BEGIN -->';
const END = '<!-- DATA:END -->';

if (!existsSync(latestPath)) {
  console.error('data/latest.json missing');
  process.exit(1);
}
const d = JSON.parse(readFileSync(latestPath, 'utf8'));
const headline = d.headline ?? {};
const compact = (n, dp = 2) => (typeof n === 'number' ? n.toFixed(dp) : String(n ?? '-'));

const order = ['mmi', 'cnn-fng', 'crypto-fng', 'india-vix'];
const rows = order.filter((k) => headline[k]).map((k) => ({ key: k, ...headline[k] }));

function gaugeSvg(items) {
  const w = 860;
  const rowH = 74;
  const h = 34 + items.length * rowH;
  const barX = 190;
  const barW = w - barX - 120;
  const parts = items.map((it, i) => {
    const v = Math.max(0, Math.min(100, Number(it.value) || 0));
    const y = 30 + i * rowH;
    const color = it.zone?.color || '#38bdf8';
    return `<g>
      <text x="16" y="${y + 20}" fill="#e6edf7" font-size="14" font-family="system-ui,sans-serif">${it.short || it.key}</text>
      <rect x="${barX}" y="${y + 6}" width="${barW}" height="18" rx="9" fill="#16233a"/>
      <rect x="${barX}" y="${y + 6}" width="${((v / 100) * barW).toFixed(1)}" height="18" rx="9" fill="${color}"/>
      <text x="${barX + barW + 12}" y="${y + 20}" fill="#e6edf7" font-size="14" font-family="monospace">${compact(it.value)}</text>
      <text x="${barX}" y="${y + 44}" fill="#8ea3bf" font-size="12" font-family="monospace">${it.zone?.label ?? 'index'} · ${it.date ?? ''} · prev ${compact(it.previous)}</text>
    </g>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#0b1220"/>${parts}</svg>`;
}

mkdirSync(assetsDir, { recursive: true });
const sentiment = rows.filter((r) => r.key !== 'india-vix');
writeFileSync(join(assetsDir, 'sentiment-gauges.svg'), gaugeSvg(sentiment));

const table = [
  '| Index | Value | Zone | As of | Previous | Change |',
  '| :--- | ---: | :--- | :--- | ---: | ---: |',
  ...rows.map((r) => {
    const delta = typeof r.value === 'number' && typeof r.previous === 'number' ? r.value - r.previous : null;
    return `| ${r.title || r.key} | ${compact(r.value)} | ${r.zone?.label ?? '—'} | ${r.date ?? '—'} | ${compact(r.previous)} | ${delta === null ? '—' : (delta >= 0 ? '+' : '') + delta.toFixed(2)} |`;
  }),
].join('\n');

const sources = Array.isArray(d.sources) ? d.sources : [];
const unavailable = Array.isArray(d.unavailable) ? d.unavailable : [];

const block = `${BEGIN}
## Current readings

_Updated ${d.updated ?? '—'} · as of ${d.asOf ?? '—'} · ${d.seriesCount ?? rows.length} series tracked_

${table}

![Market sentiment gauges](docs/assets/sentiment-gauges.svg)

## Live URLs

| Host | URL | Role |
| :--- | :--- | :--- |
| GitHub Pages | https://chirag127.github.io/fear-greed-index-api/ | canonical (domain-independent) |

## Sources

- Healthy: ${sources.length ? sources.map((s) => `\`${typeof s === 'string' ? s : s.name ?? s}\``).join(', ') : '—'}
- Unavailable: ${unavailable.length ? unavailable.map((s) => `\`${typeof s === 'string' ? s : s.name ?? s}\``).join(', ') : 'none'}

${END}`;

const readmePath = join(root, 'README.md');
let readme = readFileSync(readmePath, 'utf8');
const a = readme.indexOf(BEGIN);
const b = readme.indexOf(END);
readme = a !== -1 && b !== -1 ? readme.slice(0, a) + block + readme.slice(b + END.length) : `${readme.trimEnd()}\n\n${block}\n`;
writeFileSync(readmePath, readme);

console.log(`README updated from data/latest.json (${rows.length} headline indices)`);
