"""Build tier-share presets (share of TEER 0-3 workers/invitees in each high-wage tier) for the calculator.

Inputs (same folder): highwage.tsv, census.json (fetch.py), npr.json (npr.py).
Output: presets.json
"""
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
hw = {}
for line in open(os.path.join(HERE, "highwage.tsv")):
    code, tier, _ = line.rstrip("\n").split("\t")
    hw[code] = tier
census = json.load(open(os.path.join(HERE, "census.json")))
npr = json.load(open(os.path.join(HERE, "npr.json")))

TIERS = ["2.0x", "1.5x", "1.3x"]


def tier_of(code):
    # Census merges 00011-00015 (three at 2.0x, two at 1.5x) into 00018.
    if code == "00018":
        return {"2.0x": 0.6, "1.5x": 0.4}
    return {hw[code]: 1.0} if code in hw else {}


def shares_from_counts(counts):
    """counts: {noc: n} over TEER 0-3 NOCs -> {tier: share, 'none': share}."""
    tot = sum(counts.values())
    out = {t: 0.0 for t in TIERS}
    for code, n in counts.items():
        for t, w in tier_of(code).items():
            out[t] += n * w
    out = {t: v / tot for t, v in out.items()}
    out["none"] = 1 - sum(out.values())
    return out


def census_series(table, suffix):
    rows = census[table]
    return {k.split("|")[0]: v or 0 for k, v in rows.items()
            if k.endswith(suffix) and k[0] != "A" and k[1] in "0123"}


presets = []
for key, label, table, suffix, note in [
    ("census_all", "All workers in Canada", "all", "|total", "2021 Census, experienced labour force, TEER 0-3"),
    ("census_imm", "All immigrants (PRs)", "imm", "|all_immigrants|any_period", "2021 Census, TEER 0-3"),
    ("census_cec", "CEC immigrants, landed 2016-21", "imm", "|cec|2016_2021", "2021 Census, TEER 0-3"),
    ("census_fsw", "Skilled-worker immigrants, landed 2016-21", "imm", "|skilled_workers|2016_2021", "2021 Census, TEER 0-3"),
]:
    presets.append({"key": key, "label": label, "note": note, "shares": shares_from_counts(census_series(table, suffix))})

# Temporary residents: apportioned estimate from npr.py, TEER 0-3 denominator.
bt = npr["by_tier"]
s = {"2.0x": bt["2.0x"] + 0.6 * bt.get("2.0x/1.5x", 0), "1.5x": bt["1.5x"] + 0.4 * bt.get("2.0x/1.5x", 0), "1.3x": bt["1.3x"]}
s = {t: v / npr["t03"] for t, v in s.items()}
s["none"] = 1 - sum(s.values())
presets.append({"key": "npr", "label": "Temporary residents (estimate)",
                "note": "2021 Census, NPRs with employment income, TEER 0-3; minor groups apportioned", "shares": s})

# IRCC year-end report 2024, Table 12a: top-15 primary occupations of ITA recipients.
ITA = {
    2024: {"21231": 3715, "62020": 3608, "21232": 3142, "13110": 2669, "41220": 2136, "21222": 2091, "11100": 2079,
           "33102": 1946, "11202": 1945, "31102": 1841, "31301": 1776, "22221": 1733, "62010": 1718, "13100": 1708,
           "21221": 1517, "_other": 65279},
    2023: {"21231": 7259, "21232": 5183, "62020": 3277, "21222": 2951, "13110": 2538, "21223": 2151, "11202": 2142,
           "11100": 2090, "22221": 1844, "20012": 1841, "13100": 1747, "21211": 1654, "21221": 1600, "12200": 1599,
           "21230": 1475, "_other": 70915},
    2022: {"21231": 3848, "21222": 1889, "21230": 1855, "62020": 1558, "11202": 1025, "21223": 1025, "41200": 955,
           "13200": 945, "11201": 901, "11100": 857, "20012": 855, "22221": 842, "10022": 812, "13100": 800,
           "63200": 728, "_other": 27644},
}
for year, rows in ITA.items():
    named = {k: v for k, v in rows.items() if k != "_other"}
    top = shares_from_counts(named)
    cover = sum(named.values()) / (sum(named.values()) + rows["_other"])
    presets.append({"key": f"ita{year}_top", "label": f"IRCC invitees {year} (top 15 only)",
                    "note": f"Year-end report Table 12a; named occupations = {cover:.0%} of ITAs, rest assumed same mix",
                    "shares": top})
    if year == 2024:
        mix = {t: cover * top[t] + (1 - cover) * s[t] for t in top}
        presets.append({"key": "ita2024_blend", "label": "IRCC invitees 2024 + temp residents for the rest",
                        "note": f"Top 15 named ({cover:.0%}) from Table 12a; remaining {1 - cover:.0%} at temp-resident mix",
                        "shares": mix})

json.dump(presets, open(os.path.join(HERE, "presets.json"), "w"), indent=1)
for p in presets:
    sh = p["shares"]
    print(f"{p['label']:50} 2.0x {sh['2.0x']:5.1%}  1.5x {sh['1.5x']:5.1%}  1.3x {sh['1.3x']:5.1%}  none {sh['none']:5.1%}")
