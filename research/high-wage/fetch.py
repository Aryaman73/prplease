"""Pull 2021 Census counts by NOC unit group from StatCan WDS for the cells we need -> census.json.

Run: python3 -I research/high-wage/fetch.py
"""
import json, os, re, sys, urllib.request

BASE = "https://www150.statcan.gc.ca/t1/wds/rest/"
HERE = os.path.dirname(os.path.abspath(__file__))


def post(endpoint, body):
    req = urllib.request.Request(BASE + endpoint, data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.load(r)


def metadata(pid):
    """Cube metadata from StatCan WDS (member ids for each dimension)."""
    return post("getCubeMetadata", [{"productId": pid}])[0]["object"]


def occ_members(meta):
    for dim in meta["dimension"]:
        if "Occupation" in dim["dimensionNameEn"]:
            out = {}
            for m in dim["member"]:
                name = m["memberNameEn"]
                if m["memberId"] == 3:
                    out["ALL"] = m["memberId"]
                mm = re.match(r"^(\d{5}) ", name)
                if mm:
                    out[mm.group(1)] = m["memberId"]
            return out


def fetch(pid, coords):
    vals = {}
    for i in range(0, len(coords), 250):
        chunk = coords[i:i + 250]
        res = post("getDataFromCubePidCoordAndLatestNPeriods",
                   [{"productId": pid, "coordinate": c, "latestN": 1} for c in chunk])
        # Responses do not come back in request order; key on the echoed coordinate.
        for r in res:
            if r["status"] == "SUCCESS" and r["object"]["vectorDataPoint"]:
                vals[r["object"]["coordinate"]] = r["object"]["vectorDataPoint"][0]["value"]
        missing = [c for c in chunk if c not in vals]
        if missing:
            print("missing", len(missing), missing[:3], file=sys.stderr)
        print(pid, i + len(chunk), "/", len(coords), file=sys.stderr)
    return vals


def coord(*ids):
    ids = list(ids) + [0] * (10 - len(ids))
    return ".".join(map(str, ids))


out = {}

# 98-10-0449: whole population. geo.edu.age.gender.occ.lfs
meta449 = metadata(98100449)
occ449 = occ_members(meta449)
c449 = {(code, lfs): coord(1, 1, 1, 1, mid, lfs) for code, mid in occ449.items() for lfs in (1, 2)}
v = fetch(98100449, list(c449.values()))
out["all"] = {f"{code}|{'total' if lfs == 1 else 'employed'}": v.get(c) for (code, lfs), c in c449.items()}

# 98-10-0316: immigrants. geo.adm.edu.age.gender.occ.period
meta316 = metadata(98100316)
occ316 = occ_members(meta316)
ADM = {1: "all_immigrants", 2: "economic", 4: "skilled_workers", 10: "cec"}
PER = {1: "any_period", 8: "2016_2021"}
c316 = {(code, a, p): coord(1, a, 1, 1, 1, mid, p)
        for code, mid in occ316.items() for a in ADM for p in PER}
v = fetch(98100316, list(c316.values()))
out["imm"] = {f"{code}|{ADM[a]}|{PER[p]}": v.get(c) for (code, a, p), c in c316.items()}

json.dump(out, open(os.path.join(HERE, "census.json"), "w"), indent=0)
print("done", len(out["all"]), len(out["imm"]))
