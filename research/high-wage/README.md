# High-wage occupation points — research

Where the numbers on the **High Wage** tab come from. Python 3, standard library only.

| File | What it is |
|---|---|
| `highwage.tsv` | IRCC's 186 high-wage NOCs and tiers, from the [canada.ca list](https://www.canada.ca/en/immigration-refugees-citizenship/services/immigrate-canada/express-entry/check-score/high-wage.html) published 2026-10-16 |
| `noc2021.tsv` | All 516 NOC 2021 unit groups, so the occupation lookup can say "not listed" by name |
| `fetch.py` → `census.json` | 2021 Census counts by NOC unit group, from StatCan WDS (tables 98-10-0449 all workers, 98-10-0316 immigrants by admission category) |
| `npr.py` → `npr.json` | Temporary residents in high-wage NOCs, estimated from 98-10-0585 (NPR = total − non-immigrants − immigrants), apportioned from 4-digit minor groups |
| `analyze.py` → `highwage_with_counts.csv` | Workers in high-wage NOCs by population; per-NOC table |
| `presets.py` → `presets.json` | Tier-share presets for the projection (Census populations, NPR estimate, IRCC Year-End Report 2024 Table 12a) |
| `model.py` | Reference implementation of the cutoff model; `src/highwage/model.ts` is its port |
| `build_site_data.py` → `public/data/highwage.json` | What the site loads |

## Rebuild

```bash
python3 -I research/high-wage/fetch.py
python3 -I research/high-wage/npr.py
python3 -I research/high-wage/presets.py
python3 -I research/high-wage/build_site_data.py
```

Only `build_site_data.py` is needed when IRCC updates the list: edit `highwage.tsv`, then run it.

## Caveats

- Census data is from May 2021, before the 2022–25 rise in temporary residents.
- The Year-End Report names only the top 15 occupations of invited candidates (about a third of invitations).
- The NPR figures are an estimate: StatCan doesn't publish non-permanent residents at unit-group level.
