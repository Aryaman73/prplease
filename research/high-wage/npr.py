"""Estimate non-permanent residents (temp workers, PGWP, students who worked) in high-wage NOCs.

98-10-0585 gives employment-income recipients by NOC minor group (4-digit) for Total / Non-immigrants /
Immigrants; NPR = Total - Non-immigrants - Immigrants. Minor groups that mix listed and unlisted unit
groups are apportioned by each unit group's share of the minor group's experienced labour force
(98-10-0449), with a min/max band (all or none of that minor group's NPRs in high-wage unit groups).
"""
import json, os, re, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = "https://www150.statcan.gc.ca/t1/wds/rest/"


def post(endpoint, body):
    req = urllib.request.Request(BASE + endpoint, data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.load(r)


meta = post("getCubeMetadata", [{"productId": 98100585}])[0]["object"]
occ = [d for d in meta["dimension"] if "Occupation" in d["dimensionNameEn"]][0]["member"]
minor = {re.match(r"^(\d{4}) ", m["memberNameEn"]).group(1): m["memberId"]
         for m in occ if re.match(r"^\d{4} ", m["memberNameEn"])}
minor["ALL"] = 3
coords = {(g, s): f"1.1.{s}.1.1.1.1.{mid}.1.0" for g, mid in minor.items() for s in (1, 2, 3)}
vals = {}
cl = list(coords.values())
for i in range(0, len(cl), 250):
    for r in post("getDataFromCubePidCoordAndLatestNPeriods",
                  [{"productId": 98100585, "coordinate": c, "latestN": 1} for c in cl[i:i + 250]]):
        if r["status"] == "SUCCESS" and r["object"]["vectorDataPoint"]:
            vals[r["object"]["coordinate"]] = r["object"]["vectorDataPoint"][0]["value"]
npr = {}
for g in minor:
    t, n, im = (vals.get(coords[(g, s)]) for s in (1, 2, 3))
    npr[g] = max(0.0, t - n - im) if None not in (t, n, im) else 0.0

census = json.load(open(os.path.join(HERE, "census.json")))["all"]
hw = {l.split("\t")[0]: l.split("\t")[1] for l in open(os.path.join(HERE, "highwage.tsv"))}
hw["00018"] = "2.0x/1.5x"  # Census merges 00011-00015 (split across 2.0x and 1.5x tiers)
for c in ["00011", "00012", "00013", "00014", "00015"]:
    hw.pop(c)
units = [k.split("|")[0] for k in census if k.endswith("|total") and k[0] != "A"]

est = lo = hi = 0.0
t03 = 0.0
by_tier = {}
for g, n in npr.items():
    if g == "ALL":
        continue
    members = [u for u in units if u[:4] == g]
    tot = sum(census[f"{u}|total"] or 0 for u in members)
    hwlf = sum(census[f"{u}|total"] or 0 for u in members if u in hw)
    if tot == 0:
        continue
    share = hwlf / tot
    est += n * share
    lo += n if share == 1 else 0
    hi += n if share > 0 else 0
    for u in members:
        if u in hw:
            by_tier[hw[u]] = by_tier.get(hw[u], 0) + n * (census[f"{u}|total"] or 0) / tot
    if g[1] in "0123":
        t03 += n

all_npr = npr["ALL"]
print(f"NPRs with employment income, all occupations: {all_npr:,.0f}")
print(f"  in TEER 0-3 minor groups:                   {t03:,.0f}")
print(f"  in high-wage NOCs (apportioned estimate):   {est:,.0f}  ({est/all_npr:.1%} of all, {est/t03:.1%} of TEER0-3)")
print(f"  band (pure-HW minor groups .. any-HW):      {lo:,.0f} .. {hi:,.0f}")
print("  by tier:", {k: round(v) for k, v in by_tier.items()})
print(f"Sanity: total recipients {vals.get(coords[('ALL', 1)]):,.0f}, immigrants {vals.get(coords[('ALL', 3)]):,.0f}")
json.dump({"npr_minor": npr, "est": est, "lo": lo, "hi": hi, "t03": t03, "by_tier": by_tier},
          open(os.path.join(HERE, "npr.json"), "w"))
