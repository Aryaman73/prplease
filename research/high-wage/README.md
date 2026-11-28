# High-wage occupation points — research

Where the numbers on the **High Wage** tab come from. Python 3, standard library only, except `stockflow.py`, which needs numpy.

| File | What it is |
|---|---|
| `highwage.tsv` | IRCC's 186 high-wage NOCs and tiers, from the [canada.ca list](https://www.canada.ca/en/immigration-refugees-citizenship/services/immigrate-canada/express-entry/check-score/high-wage.html) published 2026-10-16 |
| `noc2021.tsv` | All 516 NOC 2021 unit groups, so the occupation lookup can say "not listed" by name |
| `fetch.py` → `census.json` | 2021 Census counts by NOC unit group, from StatCan WDS (tables 98-10-0449 all workers, 98-10-0316 immigrants by admission category) |
| `npr.py` → `npr.json` | Temporary residents in high-wage NOCs, estimated from 98-10-0585 (NPR = total − non-immigrants − immigrants), apportioned from 4-digit minor groups |
| `analyze.py` → `highwage_with_counts.csv` | Workers in high-wage NOCs by population; per-NOC table |
| `invitee_tiers.py` → `invitee_tiers.json` | CEC invitees by occupation from [IRCC open data](https://open.canada.ca/data/en/dataset/593e9165-c6ce-4f9b-b519-03d315f92cd4) (NOC 2011, mapped to 2021 with StatCan's correspondence). Source of the default preset |
| `presets.py` → `presets.json` | Tier-share presets for the projection (CEC invitees, Census populations, NPR estimate, IRCC Year-End Report Table 12a). `SHOWN` picks the few the site's dropdown offers and their labels; the rest are kept for comparison and don't ship |
| `stockflow.py` → `cec_stock.json` | CEC candidates per CRS point at each pre-change CEC round: a daily simulation of CEC inflow, draws, expiry and attrition, fitted to every CEC cutoff and pool snapshot from June 2025 to the change, in six variants. Stage 2 runs each fit past 3 November with the bonus applied and refits the listed-tier share to the 501-600 band of every post-change snapshot (and any post-change CEC cutoff), ruling out fits that can't match it plausibly. The site projects the next CEC cutoff from the stock at the latest post-change snapshot |
| `build_site_data.py` → `public/data/highwage.json` | What the site loads |

## Rebuild

```bash
python3 -I research/high-wage/fetch.py
python3 -I research/high-wage/npr.py
python3 -I research/high-wage/invitee_tiers.py
python3 -I research/high-wage/presets.py
python3 -I research/high-wage/stockflow.py
python3 -I research/high-wage/build_site_data.py
```

**After each new pool snapshot or CEC draw**, rerun `stockflow.py` then `build_site_data.py` so the projection uses the latest pool (the daily sync doesn't do this).

Only `build_site_data.py` is needed when IRCC updates the list: edit `highwage.tsv`, then run it. To refresh the default tier shares from IRCC's monthly invitee data, run `invitee_tiers.py`, `presets.py`, then `build_site_data.py`.

## Caveats

- Census data is from May 2021, before the 2022–25 rise in temporary residents.
- The Year-End Report names only the top 15 occupations of invited candidates (about a third of invitations).
- The NPR figures are an estimate: StatCan doesn't publish non-permanent residents at unit-group level.
- The pre-change fit stops at the last CEC draw before 3 November 2026; post-change data only sets the listed-tier share (stage 2).
- IRCC publishes 501-600 as one band, so the split inside it is the model's. All of the post-change jump is attributed to the CEC bonus; non-CEC candidates gaining job-offer points would mean fewer CEC above 500 and a lower cutoff.
- Below 500 the refitted model runs 15-32% high at the 22 November snapshot: category draws (the 27 October French draw took 5,000 from 407 up) remove more there than average attrition allows.
