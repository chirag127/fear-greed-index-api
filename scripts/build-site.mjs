#!/usr/bin/env node
/**
 * Builds the Fear & Greed site into _site/ from data/latest.json.
 *
 * Self-contained: inline CSS + inline SVG, no CDN, no template repo, no runtime
 * JS. Links are relative so the artifact works at any mount path.
 */
import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, '_site');
const d = JSON.parse(readFileSync(join(root, 'data', 'latest.json'), 'utf8'));

const head = d.headline ?? {};
const order = ['mmi', 'cnn-fng', 'crypto-fng', 'india-vix'];
const items = order.filter((k) => head[k]).map((k) => ({ key: k, ...head[k] }));
const num = (n, dp = 2) => (typeof n === 'number' ? n.toFixed(dp) : '—');
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const pct = (v) => Math.max(0, Math.min(100, Number(v) || 0));

const gaugeRows = items.filter((i) => i.key !== 'india-vix').map((i) => {
  const v = pct(i.value);
  const color = i.zone?.color || '#38bdf8';
  const delta = typeof i.value === 'number' && typeof i.previous === 'number' ? i.value - i.previous : null;
  return `<div class="g">
    <div class="gl"><span class="gn">${esc(i.title || i.short)}</span><span class="gv">${num(i.value)}</span></div>
    <div class="track"><i style="width:${v.toFixed(1)}%;background:${color}"></i></div>
    <div class="gm"><span class="zone" style="color:${color}">${esc(i.zone?.label ?? '—')}</span>
      <span>as of ${esc(i.date)} · prev ${num(i.previous)}${delta === null ? '' : ` · <b class="${delta >= 0 ? 'up' : 'down'}">${delta >= 0 ? '+' : ''}${delta.toFixed(2)}</b>`}</span></div>
  </div>`;
}).join('');

const tableRows = items.map((i) => {
  const delta = typeof i.value === 'number' && typeof i.previous === 'number' ? i.value - i.previous : null;
  return `<tr><td>${esc(i.title || i.key)}</td><td class="n">${num(i.value)}</td>
    <td>${esc(i.zone?.label ?? '—')}</td><td>${esc(i.date ?? '—')}</td>
    <td class="n ${delta === null ? '' : delta >= 0 ? 'up' : 'down'}">${delta === null ? '—' : (delta >= 0 ? '+' : '') + delta.toFixed(2)}</td></tr>`;
}).join('');

const sources = Array.isArray(d.sources) ? d.sources : [];
const unavailable = Array.isArray(d.unavailable) ? d.unavailable : [];
const chips = (arr) => arr.map((s) => `<span class="chip">${esc(typeof s === 'string' ? s : s.name ?? s)}</span>`).join('');

mkdirSync(out, { recursive: true });

writeFileSync(join(out, 'index.html'), `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Fear &amp; Greed Index API — market sentiment, four sources</title>
<meta name="description" content="Free static JSON API for market fear and greed: Tickertape MMI, CNN Fear &amp; Greed, Crypto Fear &amp; Greed and India VIX, collected hourly.">
<meta name="theme-color" content="#0b1220">
<style>
:root{--bg:#0b1220;--panel:#111b2c;--panel2:#16233a;--line:#22314b;--ink:#e6edf7;--muted:#8ea3bf;--up:#4ade80;--down:#f87171;--mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
*{box-sizing:border-box}
body{margin:0;color:var(--ink);font:15px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased;
  background:radial-gradient(1100px 520px at 84% -12%,rgba(56,189,248,.10),transparent 60%),radial-gradient(900px 460px at 6% -18%,rgba(251,191,36,.07),transparent 55%),var(--bg)}
.wrap{max-width:1000px;margin:0 auto;padding:0 20px}
.brand{display:flex;align-items:center;gap:8px;padding:14px 0;border-bottom:1px solid var(--line);font-weight:700}
.brand span{color:#38bdf8}.brand .tag{margin-left:auto;font:11px/1 var(--mono);letter-spacing:.18em;text-transform:uppercase;color:var(--muted)}
header{padding:40px 0 10px}
h1{margin:0;font-size:clamp(26px,4.6vw,42px);line-height:1.06;letter-spacing:-.02em}
h1 em{font-style:normal;color:#38bdf8}
.sub{color:var(--muted);max-width:62ch;margin:12px 0 0}
.meta{display:flex;gap:18px;flex-wrap:wrap;margin-top:16px;font:12px/1 var(--mono);color:var(--muted)}
section{margin:30px 0}
.card{background:rgba(17,27,44,.72);border:1px solid var(--line);border-radius:16px;padding:18px}
.card h2{margin:0 0 14px;font-size:14px;font-weight:600;letter-spacing:.02em}
.g{padding:12px 0;border-bottom:1px dashed rgba(34,49,75,.8)}.g:last-child{border:0}
.gl{display:flex;justify-content:space-between;align-items:baseline;gap:12px}
.gn{color:var(--ink);font-weight:600}.gv{font:600 20px/1 var(--mono);font-variant-numeric:tabular-nums}
.track{height:10px;border-radius:999px;background:var(--panel2);margin:9px 0 7px;overflow:hidden}
.track i{display:block;height:100%;border-radius:999px}
.gm{display:flex;gap:12px;flex-wrap:wrap;font:12px/1.4 var(--mono);color:var(--muted)}
.zone{font-weight:700;letter-spacing:.04em}
table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}
th,td{padding:9px 10px;border-bottom:1px solid var(--line);text-align:left;font-size:13px}
th{color:var(--muted);font:11px/1 var(--mono);letter-spacing:.12em;text-transform:uppercase}
td.n{text-align:right;font-family:var(--mono)}
tbody tr:hover{background:rgba(56,189,248,.05)}
.up{color:var(--up)}.down{color:var(--down)}
.chip{display:inline-block;padding:3px 9px;margin:0 6px 6px 0;border:1px solid var(--line);border-radius:999px;font:12px var(--mono);color:var(--muted)}
pre{background:#0a1120;border:1px solid var(--line);border-radius:12px;padding:14px;overflow:auto;font:12.5px var(--mono);margin:0}
.links{display:flex;gap:18px;flex-wrap:wrap;margin-top:14px;font-size:13px}
.links a{color:#38bdf8;text-decoration:none}.links a:hover{text-decoration:underline}
footer{border-top:1px solid var(--line);margin-top:40px;padding:20px 0 44px;color:var(--muted);font-size:12.5px}
</style></head><body><div class="wrap">
<div class="brand">FEAR<span>&amp;</span>GREED<span class="tag">Sentiment API</span></div>
<header><h1>Market sentiment, <em>four sources</em>, one JSON.</h1>
<p class="sub">Tickertape Market Mood Index, CNN Fear &amp; Greed, Crypto Fear &amp; Greed and India VIX —
collected hourly by GitHub Actions and served as a free static JSON API.</p>
<div class="meta"><span>updated <b>${esc(d.updated)}</b></span><span>as of <b>${esc(d.asOf)}</b></span><span><b>${esc(d.seriesCount ?? items.length)}</b> series</span></div>
</header>

<section><div class="card"><h2>Current readings</h2>${gaugeRows}</div></section>

<section><div class="card"><h2>All indices</h2>
<table><thead><tr><th>Index</th><th style="text-align:right">Value</th><th>Zone</th><th>As of</th><th style="text-align:right">Change</th></tr></thead>
<tbody>${tableRows}</tbody></table></div></section>

<section><div class="card"><h2>Sources</h2>
<div><span class="chip">healthy</span>${chips(sources)}</div>
<div><span class="chip">unavailable</span>${unavailable.length ? chips(unavailable) : '<span class="chip">none</span>'}</div>
</div></section>

<section><div class="card"><h2>API</h2>
<pre>GET data/latest.json      # headline + every series
GET data/index.json       # series manifest</pre>
<div class="links"><a href="data/latest.json">data/latest.json</a><a href="https://github.com/chirag127/fear-greed-index-api">source</a></div>
</div></section>

<footer>Proprietary indices belong to their publishers; this project only republishes public readings.
Not investment advice.</footer>
</div></body></html>`);

for (const dir of ['data']) if (existsSync(join(root, dir))) cpSync(join(root, dir), join(out, dir), { recursive: true });
if (existsSync(join(root, 'logo.svg'))) cpSync(join(root, 'logo.svg'), join(out, 'logo.svg'));

console.log(`built _site/index.html from ${items.length} headline indices`);
