"""Summarise census.json: workers in high-wage NOCs by population; writes highwage_with_counts.csv."""
import csv, json, os
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
d = json.load(open(os.path.join(HERE, "census.json")))
hw = {}
for line in open(os.path.join(HERE, "highwage.tsv")):
    code, tier, title = line.rstrip("\n").split("\t")
    hw[code] = (tier, title)

A, I = d["all"], d["imm"]
codes = sorted({k.split("|")[0] for k in A if k[0] != "A"})
missing = [c for c in hw if f"{c}|total" not in A]
print("unit groups in census:", len(codes), "| HW codes missing from census:", missing)
teer = lambda c: c[1]
print("HW by TEER:", {t: sum(1 for c in hw if teer(c) == t) for t in "012345"})
print("All by TEER:", {t: sum(1 for c in codes if teer(c) == t) for t in "012345"})

series = [("all|employed", lambda c: A.get(f"{c}|employed")),
          ("all|exp_labour_force", lambda c: A.get(f"{c}|total"))]
for adm in ["all_immigrants", "economic", "skilled_workers", "cec"]:
    for per in ["any_period", "2016_2021"]:
        series.append((f"imm|{adm}|{per}", lambda c, a=adm, p=per: I.get(f"{c}|{a}|{p}")))

print(f"\n{'series':38} {'total':>11} {'TEER0-3':>11} {'HW':>11} {'2.0x':>9} {'1.5x':>10} {'1.3x':>10} {'HW%all':>7} {'HW%T03':>7}")
for name, f in series:
    tot = sum(f(c) or 0 for c in codes)
    t03 = sum(f(c) or 0 for c in codes if teer(c) in "0123")
    by = defaultdict(float)
    for c in hw:
        by[hw[c][0]] += f(c) or 0
    h = sum(by.values())
    allocc = f("ALL")
    print(f"{name:38} {tot:11,.0f} {t03:11,.0f} {h:11,.0f} {by['2.0x']:9,.0f} {by['1.5x']:10,.0f} {by['1.3x']:10,.0f} {h/tot:7.1%} {h/t03:7.1%}   (ALL row {allocc:,.0f})")

# per-NOC table
with open(os.path.join(HERE, "highwage_with_counts.csv"), "w", newline="") as fh:
    w = csv.writer(fh)
    w.writerow(["noc", "teer", "tier", "title", "employed_2021_all", "immigrants_2021", "immigrants_landed_2016_2021",
                "economic_imm_2016_2021", "cec_any_period"])
    for c in sorted(hw, key=lambda c: -(A.get(f"{c}|employed") or 0)):
        w.writerow([c, teer(c), hw[c][0], hw[c][1], A.get(f"{c}|employed"), I.get(f"{c}|all_immigrants|any_period"),
                    I.get(f"{c}|all_immigrants|2016_2021"), I.get(f"{c}|economic|2016_2021"), I.get(f"{c}|cec|any_period")])

print("\nTop 15 HW NOCs by recent (2016-21) immigrants:")
for c in sorted(hw, key=lambda c: -(I.get(f"{c}|all_immigrants|2016_2021") or 0))[:15]:
    print(f"  {c} {hw[c][0]} {hw[c][1][:55]:55} recent_imm={I.get(f'{c}|all_immigrants|2016_2021'):>8,.0f}  employed_all={A.get(f'{c}|employed'):>9,.0f}")

print("\nTop 15 NON-HW TEER0-3 NOCs by recent immigrants (big losers):")
names = {}
for c in sorted([c for c in codes if c not in hw and teer(c) in "0123"], key=lambda c: -(I.get(f"{c}|all_immigrants|2016_2021") or 0))[:15]:
    print(f"  {c} recent_imm={I.get(f'{c}|all_immigrants|2016_2021'):>8,.0f}")
