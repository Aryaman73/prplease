"""Write public/data/highwage.json for the site's High Wage tab.

Inputs (this folder):
  highwage.tsv  - IRCC's 186 high-wage NOCs and tiers (canada.ca list published 2026-10-16)
  noc2021.tsv   - all 516 NOC 2021 unit groups, so a lookup can say "not listed" by name
  presets.json  - tier-share presets (presets.py)

Run: python3 -I research/high-wage/build_site_data.py
"""
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "..", "public", "data", "highwage.json")

tiers = {}
for line in open(os.path.join(HERE, "highwage.tsv")):
    code, tier, _ = line.rstrip("\n").split("\t")
    tiers[code] = tier

occupations = []
for line in open(os.path.join(HERE, "noc2021.tsv")):
    code, title = line.rstrip("\n").split("\t")
    occupations.append({"noc": code, "title": title, "tier": tiers.get(code)})

presets = json.load(open(os.path.join(HERE, "presets.json")))
for p in presets:
    p["shares"] = {k: round(v, 4) for k, v in p["shares"].items()}

data = {
    "effective": "2026-11-03",
    "listPublished": "2026-10-16",
    "listUrl": "https://www.canada.ca/en/immigration-refugees-citizenship/services/immigrate-canada/express-entry/check-score/high-wage.html",
    # IRCC, "2026 changes to points for Canadian work experience and job offers":
    # the Labour Market Integration factor pays max(work-length + high-wage bonus, job offer).
    "changesUrl": "https://www.canada.ca/en/immigration-refugees-citizenship/services/immigrate-canada/express-entry/changes.html",
    "points": {
        "experience": {"2.0x": 70, "1.5x": 40, "1.3x": 20},
        "offer": {"2.0x": 100, "1.5x": 70, "1.3x": 50},
    },
    "occupations": occupations,
    "presets": presets,
    "defaultPreset": "ita2024_blend",
}
assert sum(1 for o in occupations if o["tier"]) == 186
json.dump(data, open(OUT, "w"), indent=1, ensure_ascii=False)
open(OUT, "a").write("\n")
print("wrote", os.path.relpath(OUT), len(occupations), "occupations,", len(presets), "presets")
