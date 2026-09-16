# Quarantined: legacy MMI values (untrusted)

**Do not use these values. Do not backfill charts from them.**

These 60 daily files were produced by the original `scripts/scrape.mjs` between
2026-06-22 and 2026-08-24. They are retained only as an audit trail.

## Why they are untrusted

The original scraper's primary parser was:

```js
html.match(/"mmi"\s*:\s*\{[^}]*"now"\s*:\s*([0-9.]+)/)
```

That pattern **no longer matches** Tickertape's HTML. Tickertape now publishes
the score at `props.pageProps.nowData.currentValue` inside `__NEXT_DATA__`, and
the old key name is gone.

Because the primary parser failed silently, the scraper fell through to a
free-text number guess:

```js
const txt = $('body').text();
const m = txt.match(/Market Mood Index[\s\S]{0,200}?([0-9]{1,3}\.[0-9]+|[0-9]{1,3})/);
```

Verified against the live page, that fallback matches:

| Input                 | Match | Source of the match                                   |
| --------------------- | ----- | ----------------------------------------------------- |
| raw HTML              | `0`   | JSON-LD prose ("Market Mood Index for making informed…") |
| tags stripped         | `535` | the CSS variable `--font_primary: #535B62`             |

A parser that can return a hex-colour fragment is not a parser. The recorded
values looked plausible (they sit in 0–100), which is precisely what made the
bug survive — it never threw, it never logged a warning, and CI stayed green
while the numbers were wrong.

## What replaced it

`scripts/sources/tickertape.mjs` parses `__NEXT_DATA__` as JSON and **throws**
if `nowData.currentValue` is absent, so a layout change fails loudly instead of
silently emitting noise. `scripts/verify.mjs` asserts the range, ordering and
internal consistency of every emitted series.

The 60 files stay here unmodified. No series in `data/series/` is derived from
them.
