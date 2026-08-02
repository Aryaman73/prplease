# PR, Please

An Express Entry draws tracker and PR process tracker, in the style of *Papers, Please*.

### → [aryamans.me/prplease](https://aryamans.me/prplease/)

[![The bulletin view: a stencilled masthead with a maple-leaf crest, a green CRT panel showing the last draw date, and the two most recent rounds of invitations laid out as parchment documents.](docs/screenshot.png)](https://aryamans.me/prplease/)

Static site, deployed to GitHub Pages. Data is refreshed twice daily by a GitHub
Action and committed into `public/data/`.

**Unofficial.** Data is derived from IRCC's own public feeds, but this site is not
affiliated with or endorsed by IRCC or the Government of Canada. Always confirm
against the [official rounds page](https://www.canada.ca/en/immigration-refugees-citizenship/services/immigrate-canada/express-entry/submit-profile/rounds-invitations.html).

## Commands

```bash
npm run sync       # refresh public/data/ from IRCC (no dependencies required)
npm run dev        # local dev server at /prplease/
npm run build      # production build to dist/
npm run typecheck  # tsc over src/
```

## Design

Diegetic chrome, legible data. The frame is *Papers, Please*; the numbers are never
stylized past the point of being readable.

- **The palette is the booth, not the documents.** Everything structural is dim and
  desaturated, so paper is the only bright plane on screen and data always sits on
  the lightest surface in view. Saturated colour is rationed to stamps.
- **Two faces, and a hard line between them.** Silkscreen (bitmap) is a *display*
  face: measured, its cap height is 0.625em and its advance 0.875em, so it lands on
  whole pixels only at multiples of 8px. That makes 16px its smallest usable size —
  8px draws a 5px capital, which is shorter than the 6.8px x-height of the body
  copy, so labels set in it read as smaller than the prose they label. Silkscreen
  therefore marks structure (tabs, bands, titles, term names, stamps) and nothing
  else; Courier Prime takes everything that must be small — axis ticks, table
  headers, field labels — on a 12/13/14/15px scale. The pixel steps are not to be
  interpolated. Silkscreen's 700 weight is deliberately not loaded: its advance is
  fractional at every size, so bold pixel type can never be crisp.
- **Stamps are the interaction verb.** `mix-blend-mode: multiply` puts the ink *in*
  the paper; a screen-blended grain overlay breaks it up so it reads as pressed
  rather than printed.
- **Everything is generated.** Paper grain and noise come from an inline
  `feTurbulence` data URI, so the page has no external asset dependencies at all.
  Fonts are self-hosted (26 KB total, OFL).
- **Mobile drops the booth.** Below 620px the desk metaphor is abandoned: stamps
  unrotate, verdict rows go single-column. Palette, stamps and type carry it instead.

Total shipped weight is ~12.5 KB of JS and ~4.1 KB of CSS, gzipped.

## Views

| Route | What it shows |
| --- | --- |
| `#/` | Bulletin — the latest round and the latest CEC round, plus the score check |
| `#/log` | Entry Log — CRS cut-off over time, and the ledger of every round |
| `#/pool` | The Pool — CRS composition of the pool over time |
| `#/file` | Your File — queue position from IRCC data, and a personal milestone tracker |
| `#/rulebook` | Rulebook — the glossary |

### Your File (`#/file`)

Two halves. The first is IRCC's own answer to "where am I in the queue": pick a
stream and an AOR month and it reads `people-ahead` straight out of `flpt-en.json`.
The second is a personal milestone tracker (ITA → AOR → BIL → … → COPR, with ADR
sitting outside the sequence because it can arrive at any point).

**The milestone dates live in `localStorage` and nowhere else.** There is no backend
to send them to, which is the point — immigration dates are not something to collect
casually. Corrupt or unavailable storage (private mode, quota) is caught and
degrades to an unsaved session rather than a broken page.

Values from IRCC are shown as IRCC wrote them: the panel prints "About 6 months",
not a re-derived "183 days". Restating someone else's estimate at a precision they
didn't claim is its own kind of error.

### The CRS chart (`#/log`)

The plot carries **one series**: the caller scopes the data by period and category,
and only those rounds are drawn. That is deliberate — mixing PNP (cut-offs in the
700–800s) with CEC (low 500s) on one axis squashes CEC into a sliver. The y-axis
fits the category you asked about.

Mark colour is validated against the *parchment* surface rather than a white one:

```bash
node dataviz/scripts/validate_palette.js "#2a6ba8" --mode light --surface "#d7cdb8"
```

Two things it does deliberately:

- **The line breaks after 180 days without a draw.** CEC ran in 2015, went dormant
  for years, then resumed. A single unbroken polyline drew a confident trend straight
  through a period containing no draws at all.
- **Marks shrink when draws bunch up**, and the axis switches from years to months
  under a ~2.5-year span, so a one-year window isn't labelled just "2026".

### The Pool (`#/pool`)

A stacked area of the seven top-level CRS bands. These are an **ordered scale**, not
nominal categories, so they take one hue running light→dark with score — never seven
separate hues — validated in ordinal mode:

```bash
node dataviz/scripts/validate_palette.js "#6b93b3,#5a7fa0,#4a6c8c,#3b5a78,#2d4964,#203851,#14273d" \
     --ordinal --mode light --surface "#d7cdb8"
```

The ramp starts mid-tone rather than pale: parchment is itself a light surface, and a
conventional light end washed out against it (a first attempt failed the light-end
contrast check at 1.05:1).

**Snapshots are keyed on `poolAsOf`, not on the draw date.** IRCC measures the pool
roughly every two weeks and then republishes that same distribution with every draw
until the next measurement — so four draws in one week all carry Sunday's figures.
Keyed by draw, a two-year window showed 125 "snapshots" with visible runs of
identical rows; keyed by measurement date it shows the 63 observations that actually
exist. The sub-bands are also excluded here: `451-500` and `401-450` each contain
five sub-bands that sum to them, and stacking both would double-count the pool.

### Interaction

Every chart gets a crosshair that snaps to the nearest point by date, and keyboard
focus plus arrow keys gives the identical readout. Neither gates anything — the table
beneath each chart carries every plotted value in full.

## Data sources

All three are public, unauthenticated JSON feeds that power pages on canada.ca.
They are undocumented, so `sync.mjs` asserts their shape on every run and refuses
to write anything if the shape has drifted.

| Feed | What it gives us |
| --- | --- |
| `ee_rounds_123_en.json` | Every round of invitations since 2015-01-31 (431 and counting): date, category, size, CRS cutoff, tie-break timestamp, and the full CRS pool distribution as of that draw. |
| `flpt-en.json` | Current processing time, total applications waiting, and — the useful part — **people ahead of you, keyed by AOR month**, per stream. |
| `data-ptime-non-country-en.json` | Odds and ends, including Federal Skilled Trades, which has no stream of its own in the feed above. |

### Things upstream does that you should know about

These are handled, but they explain why the parsers look defensive:

- **`drawName` is free text** and IRCC extends it without warning (a "Skilled Military
  Recruits" category appeared in 2026). Unmatched names land in `uncategorized` and are
  listed in `meta.json` rather than being silently bucketed.
- **`drawCutOff` has ~78 distinct format variants** across its history: single-digit days,
  double spaces, `.` where a `,` belongs, a stray `AM`/`PM` on a 24-hour clock, missing
  `at`, missing `UTC`. 354 of 355 parse; the last one (draw 208) is missing its year
  entirely and is exposed as `tieBreak: null` with the raw string retained.
- **The CRS band sums don't always add up.** Draw 247 publishes `451-500 = 55,867` while
  its sub-bands sum to `55,687` — a digit transposition in IRCC's data. Mismatches are
  reported in `meta.json`; more than 5 of them fails the build as likely schema drift.
- **Processing values are human-readable strings** ("More than 10 years", "Not enough
  data"). Every parsed number keeps its `raw` string so the UI can display exactly what
  IRCC published rather than a lossy interpretation.

### Generated files

| File | Contents |
| --- | --- |
| `public/data/draws.json` | Normalized rounds, newest first, with pool distributions. ~31 KB gzipped. |
| `public/data/processing.json` | EE streams with current times and per-AOR-month queue positions. |
| `public/data/timelines.json` | Aggregated community timelines (percentiles only). |
| `public/data/meta.json` | Content hashes, upstream update dates, and any warnings. |
| `data/history/processing/YYYY-MM-DD.json` | Daily snapshot — see below. |

### Why `data/history/` matters

IRCC publishes only *current* processing times; there is no historical series
anywhere. Each sync appends a dated snapshot, so this directory slowly becomes a
processing-time history that doesn't otherwise exist. It costs almost nothing and it
only works if it starts early, so it's in from day one.

## Community timelines

`data/timelines.csv` is hand-curated and edited directly. One row per applicant
timeline; every date column is optional except `aor_date`, which anchors all the
gap calculations and matches how IRCC keys its own queue data.

```csv
id,stream,ita_date,aor_date,bil_date,biometrics_date,medical_date,eligibility_date,adr_date,adr_type,p1_date,p2_date,copr_date,notes
r1,cec,2025-01-15,2025-02-01,2025-02-05,2025-02-20,2025-03-01,2025-06-10,,,2025-07-01,2025-07-20,2025-07-25,
```

Dates are `YYYY-MM-DD`. `sync.mjs` validates every row and reports rejects with line
numbers; bad rows are skipped rather than failing the build, so one typo can't take
the site down:

```
[warn] 2 timeline row(s) rejected:
         data/timelines.csv:5 — bil_date precedes aor_date
         data/timelines.csv:7 — bil_date "15/03/2025" is not YYYY-MM-DD
```

Checks: valid `YYYY-MM-DD`, no future dates, `aor_date` present, and stages in
non-decreasing order. `adr_date` is exempt from ordering since an ADR can arrive at
any point. Gaps are signed — `ita` sits before AOR, so its median is negative.

**Only aggregates are published.** `timelines.json` contains percentiles and monthly
medians, never raw rows. The aggregate is the interesting part, and it avoids
republishing anyone else's dataset verbatim.

## Deployment

`deploy.yml` builds and publishes to Pages on every push to `main`. Because project
pages are served from a subpath, `vite.config.ts` sets `base: '/prplease/'` and all
runtime data fetches go through `import.meta.env.BASE_URL`. Repository settings must
have Pages source set to **GitHub Actions**, not a branch.

`docs/` holds the README screenshot only and is not part of the build. To refresh it
after a visual change, serve `dist/` under the `/prplease/` subpath the app expects —
a bare `file://` load will not do, since every asset URL is absolute:

```bash
npm run build && mkdir -p /tmp/shot/prplease && cp -R dist/. /tmp/shot/prplease/
(cd /tmp/shot && python3 -m http.server 4173 &) && sleep 1
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new \
  --hide-scrollbars --force-device-scale-factor=2 --window-size=1120,690 \
  --virtual-time-budget=10000 --screenshot=docs/screenshot.png \
  http://127.0.0.1:4173/prplease/
magick docs/screenshot.png -strip -colors 256 PNG8:docs/screenshot.png
```

The palette pass is not cosmetic: the grain is `feTurbulence` noise, which is
high-entropy and defeats PNG compression outright. Full colour lands at 1.4 MB and
256 colours at 276 KB, with no visible difference at any zoom.

## Operational notes

- **The 60-day cron problem.** GitHub disables scheduled workflows after 60 days with
  no repository activity, and pushes made with the default `GITHUB_TOKEN` do not
  reliably reset that clock. If the sync goes quiet, that's why. Fix it by pushing the
  data commits with a PAT instead, or by touching the repo manually every couple of
  months. Left as-is for now to avoid a secret this project doesn't otherwise need.
- **Failure is loud and safe.** On schema drift or a failed fetch, `sync.mjs` exits 1
  before writing anything, so the site keeps serving the last known-good data while the
  workflow goes red.
- **No empty commits.** Output is written with sorted keys and compared by content
  hash; `meta.json` carries `dataChangedAt`, which only moves when the data does. The
  workflow run history is the record of *checks*; the git history records *changes*.
