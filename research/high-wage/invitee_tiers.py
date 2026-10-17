"""Tier shares of CEC invitees by occupation -> invitee_tiers.json.

IRCC's "Express Entry-Invited Candidates" open data gives invitees who applied, by
invitation category and 4-digit NOC 2011 intended occupation. This maps those codes
to NOC 2021 unit groups with StatCan's NOC 2016 v1.3 -> 2021 v1.0 correspondence
(NOC 2016 kept the 2011 4-digit codes), then to the high-wage tiers in highwage.tsv.
Where a code splits, it goes 80% to the unit group it "continues as" and the rest by
2021 Census employment; otherwise it splits by Census employment.

Method from the October 2026 audit of the High Wage tab. Counts are rounded to 5 by
IRCC and "--" (1-4) is counted as 2.

Run: python3 -I research/high-wage/invitee_tiers.py
"""
import csv
import io
import json
import os
import re
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
SOURCES = {
    "invitees": "https://www.ircc.canada.ca/opendata-donneesouvertes/data/EN_ODP-EE_Candidates-OccCEC.xlsx",
    "correspondence": "https://www.statcan.gc.ca/en/statistical-programs/document/noc2016v1_3-noc2021v1_0-eng.csv",
}
UA = {"User-Agent": "prplease-sync (+https://aryamans.me/prplease)"}
NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"


def download(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120) as r:
        return r.read()


def xlsx_rows(blob):
    """First sheet of an XLSX as lists of cell values (stdlib only)."""
    z = zipfile.ZipFile(io.BytesIO(blob))
    shared = []
    if "xl/sharedStrings.xml" in z.namelist():
        for si in ET.fromstring(z.read("xl/sharedStrings.xml")).iter(f"{NS}si"):
            shared.append("".join(t.text or "" for t in si.iter(f"{NS}t")))
    rows = []
    for row in ET.fromstring(z.read("xl/worksheets/sheet1.xml")).iter(f"{NS}row"):
        vals = []
        for c in row.iter(f"{NS}c"):
            col = 0
            for ch in re.match(r"[A-Z]+", c.get("r")).group(0):
                col = col * 26 + ord(ch) - 64
            vals.extend([None] * (col - 1 - len(vals)))
            v = c.find(f"{NS}v")
            if c.get("t") == "s" and v is not None:
                vals.append(shared[int(v.text)])
            elif c.get("t") == "inlineStr":
                vals.append("".join(t.text or "" for t in c.iter(f"{NS}t")))
            elif v is not None:
                try:
                    f = float(v.text)
                    vals.append(int(f) if f.is_integer() else f)
                except ValueError:
                    vals.append(v.text)
            else:
                vals.append(None)
        rows.append(vals)
    return rows


def national_block(rows):
    """{noc4: {column label: value}} for the all-Canada block, plus the year columns."""
    hdr = next(r for r in rows if r and r[0] and str(r[0]).startswith("Province/Territory"))
    # Whole years ("2025") and the running partial year ("Jan-Jul 2026").
    cols = {str(v): j for j, v in enumerate(hdr)
            if v is not None and re.fullmatch(r"\d{4}|[A-Z][a-z]{2}-[A-Z][a-z]{2} \d{4}", str(v))}
    start = next(i for i, r in enumerate(rows) if r and r[0] == "Total")
    out = {}
    for r in rows[start:]:
        if r and r[0] and str(r[0]).startswith("Total - All"):
            break
        cell = next((c for c in r[:2] if c and re.match(r"^\d{4} - ", str(c))), None)
        if cell:
            out[str(cell)[:4]] = {label: (r[j] if j < len(r) else None) for label, j in cols.items()}
    return out, list(cols)


def count(v):
    if v is None:
        return 0.0
    if v == "--":
        return 2.0
    return float(str(v).replace(",", ""))


def main():
    tiers = {}
    for line in open(os.path.join(HERE, "highwage.tsv")):
        code, tier, _ = line.rstrip("\n").split("\t")
        tiers[code] = tier
    census = json.load(open(os.path.join(HERE, "census.json")))
    weight = {k.split("|")[0]: (v or 0) for k, v in census["all"].items() if k.endswith("|total")}
    for code in ["00011", "00012", "00013", "00014", "00015"]:  # census merges these as 00018
        weight[code] = weight.get("00018", 0) / 5

    targets, notes = defaultdict(list), {}
    text = download(SOURCES["correspondence"]).decode("utf-8-sig")
    for r in list(csv.reader(io.StringIO(text)))[1:]:
        if len(r) >= 4 and r[0].strip():
            targets[r[0].strip()].append(r[3].strip())
            notes[r[0].strip()] = r[5].strip() if len(r) > 5 else ""

    def split(code16):
        ts = targets.get(code16)
        if not ts:
            return None
        if len(ts) == 1:
            return {ts[0]: 1.0}
        m = re.search(r"continues as (\d{5})", notes.get(code16, ""))
        if m and m.group(1) in ts:
            rest = [t for t in ts if t != m.group(1)]
            total = sum(weight.get(t, 0) for t in rest) or 1
            return {m.group(1): 0.8, **{t: 0.2 * weight.get(t, 0) / total for t in rest}}
        total = sum(weight.get(t, 0) for t in ts) or 1
        return {t: weight.get(t, 0) / total for t in ts}

    table, labels = national_block(xlsx_rows(download(SOURCES["invitees"])))
    out = {"source": SOURCES, "periods": {}}
    for label in labels:
        by = defaultdict(float)
        unmapped = 0.0
        for code, years in table.items():
            n = count(years.get(label))
            parts = split(code) if n else None
            if n and parts is None:
                unmapped += n
            for unit, w in (parts or {}).items():
                by[tiers.get(unit, "none")] += n * w
        total = sum(by.values())
        if total:
            out["periods"][label] = {
                "n": round(total),
                "unmapped": round(unmapped),
                "counts": {t: round(by[t], 1) for t in ["2.0x", "1.5x", "1.3x", "none"]},
            }
    json.dump(out, open(os.path.join(HERE, "invitee_tiers.json"), "w"), indent=1)
    for label, p in list(out["periods"].items())[-4:]:
        sh = {t: c / p["n"] for t, c in p["counts"].items()}
        print(f"{label:13} n={p['n']:6} | 2.0x {sh['2.0x']:5.1%} 1.5x {sh['1.5x']:5.1%} 1.3x {sh['1.3x']:5.1%} none {sh['none']:5.1%}")


if __name__ == "__main__":
    main()
