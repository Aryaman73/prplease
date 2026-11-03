"""CEC stock-flow model -> cec_stock.json: CEC candidates per CRS point at each pre-change CEC round.

Replaces the original projection's two weakest assumptions (October 2026 audit): a smooth
geometric 501-600 band and one CEC-eligible share at every score. CEC draws every two weeks
drain CEC candidates above the cutoff, so they pile up just below it; this models that directly.

Simulation, one step per day from May 2024 (after the last general draw), CRS 380-700:
- new CEC profiles arrive with a piecewise log-linear score shape (log values at KNOTS) and a
  yearly growth trend;
- each CEC draw removes everyone above its actual cutoff and enough at the cutoff to match its
  size; profiles expire after 365 days; a weekly attrition rate stands in for everything else
  (category draws, PNP nominations, withdrawals).

Fitted with Nelder-Mead to two things at once, from June 2025 to the last pre-change CEC draw:
- each CEC draw's cutoff, given its actual size (continuous cutoff, target = cutoff + 0.5);
- IRCC's pool bands at each snapshot: band = simulated CEC stock + a constant, non-negative
  non-CEC count per band (461-470 ... 491-500 and 501-600).

Variants refit under different assumptions; the site shows their spread as the range.

Needs numpy. Run: python3 -I research/high-wage/stockflow.py   (about 2 minutes)
"""
import datetime as dt
import json
import math
import os

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
DRAWS = os.path.join(HERE, "..", "..", "public", "data", "draws.json")
OUT = os.path.join(HERE, "cec_stock.json")
EFFECTIVE = "2026-11-03"
LO, HI = 380, 700
EXPORT_LO, EXPORT_HI = 420, 640  # enough for any draw size the site allows, shifted by up to +70
BASES = 12
BANDS = [("501-600", 501, 600, 1000.0), ("491-500", 491, 500, 500.0), ("481-490", 481, 490, 500.0),
         ("471-480", 471, 480, 500.0), ("461-470", 461, 470, 500.0)]
KNOTS = [460, 490, 510, 530, 560, 600]
# The headline fit uses the smooth 6-knot shape. A 9-knot shape fits the draws no better
# (cutoff RMSE 1.51 vs 1.50) but puts a spike at 505-509 over a dip at 490-500, so it
# stays in only as a variant.
VARIANTS = [
    {"key": "central", "label": "Central fit"},
    {"key": "flexible", "label": "More flexible inflow shape", "knots": [460, 480, 495, 505, 515, 525, 540, 560, 600]},
    {"key": "attrition_low", "label": "Attrition fixed at 5% a week", "lam": 0.05},
    {"key": "attrition_high", "label": "Attrition fixed at 13% a week", "lam": 0.13},
    {"key": "bands_heavy", "label": "Pool bands weighted 4x", "band_weight": 4.0},
    {"key": "cutoffs_heavy", "label": "Cutoffs weighted 4x", "band_weight": 0.25},
]

day = lambda s: dt.date.fromisoformat(s[:10]).toordinal()
S = np.arange(LO, HI + 1)
col = lambda s: s - LO

data = json.load(open(DRAWS))
eff = day(EFFECTIVE)
cec = sorted((r for r in data["rounds"] if r["category"] == "cec" and r["invitations"] and r["crsCutoff"]
              and day(r["date"]) < eff), key=lambda r: r["date"])
START, FIT_FROM = day("2024-05-01"), day("2025-06-01")
END = day(cec[-1]["date"]) + 1
draws = {day(r["date"]): r for r in cec}
snaps = {}
for r in data["rounds"]:
    if r["poolAsOf"] and FIT_FROM <= day(r["date"]) < END:
        t = dt.datetime.strptime(r["poolAsOf"], "%B %d, %Y").date().toordinal()
        if all(r["pool"]["bands"].get(k) is not None for k, *_ in BANDS):
            snaps[t] = r["pool"]["bands"]


def simulate(theta, knots, lam_fixed=None, band_weight=1.0, record=()):
    k = len(knots)
    logk, rest = theta[:k], list(theta[k:])
    lam = lam_fixed if lam_fixed is not None else rest.pop(0)
    g = rest[0]
    inflow = np.exp(np.interp(S, knots, logk))
    surv = math.exp(math.log(1 - min(max(lam, 0.0), 0.5)) / 7)
    ring, idx = np.zeros((365, S.size)), 0
    cut_err, obs, sim, rec = [], [], [], {}
    for t in range(START, END):
        ring *= surv
        ring[idx] = inflow * math.exp(g * (t - FIT_FROM) / 365.0)
        idx = (idx + 1) % 365
        if t in snaps:
            stock = ring.sum(axis=0)
            obs.append([snaps[t][b] for b, *_ in BANDS])
            sim.append([stock[col(a):col(b) + 1].sum() for _, a, b, _ in BANDS])
        r = draws.get(t)
        if not r:
            continue
        stock = ring.sum(axis=0)
        size, ac = r["invitations"], r["crsCutoff"]
        cum = np.cumsum(stock[::-1])[::-1]
        if t >= FIT_FROM:
            i = max(int(np.searchsorted(-cum, -size, side="right")) - 1, 0)
            creal = S[i] + ((cum[i] - size) / stock[i] if stock[i] > 0 else 0.0)
            cut_err.append(creal - (ac + 0.5))
        if r["date"] in record:
            rec[r["date"]] = stock.copy()
        above = cum[col(ac) + 1] if col(ac) + 1 < S.size else 0.0
        take = max(0.0, min(1.0, (size - above) / stock[col(ac)])) if stock[col(ac)] > 0 else 0.0
        ring[:, col(ac) + 1:] = 0
        ring[:, col(ac)] *= 1 - take
    obs, sim = np.array(obs), np.array(sim)
    noncec = np.clip((obs - sim).mean(axis=0), 0, None)
    sigma = np.array([s for *_, s in BANDS]) / math.sqrt(band_weight)
    resid = (obs - sim - noncec) / sigma
    return np.array(cut_err), resid, noncec, rec, lam, g


def nelder_mead(f, x0, step, iters=900, tol=1e-4):
    n = len(x0)
    pts = [np.array(x0, float)] + [np.array(x0, float) + np.eye(n)[i] * step[i] for i in range(n)]
    vals = [f(p) for p in pts]
    for _ in range(iters):
        order = np.argsort(vals)
        pts, vals = [pts[i] for i in order], [vals[i] for i in order]
        if abs(vals[-1] - vals[0]) < tol * (1 + abs(vals[0])):
            break
        cen = np.mean(pts[:-1], axis=0)
        xr = cen + (cen - pts[-1]); fr = f(xr)
        if fr < vals[0]:
            xe = cen + 2 * (cen - pts[-1]); fe = f(xe)
            pts[-1], vals[-1] = (xe, fe) if fe < fr else (xr, fr)
        elif fr < vals[-2]:
            pts[-1], vals[-1] = xr, fr
        else:
            xc = cen + 0.5 * (pts[-1] - cen); fc = f(xc)
            if fc < vals[-1]:
                pts[-1], vals[-1] = xc, fc
            else:
                pts = [pts[0]] + [pts[0] + 0.5 * (p - pts[0]) for p in pts[1:]]
                vals = [vals[0]] + [f(p) for p in pts[1:]]
    i = int(np.argmin(vals))
    return pts[i]


def start_point(knots):
    # 2024 Year-End Report Table 2 shape (new eligible profiles by band), 8/day at 519, steeper above 500.
    mid = np.array([325.5, 375.5, 425.5, 475.5, 525.5, 575.5, 625.5, 675.5])
    per = np.array([36651, 82719, 91445, 89782, 25304, 1973, 304, 77]) / 50.0
    shape = lambda s: np.exp(np.interp(s, mid, np.log(per)))
    kn = np.array(knots, float)
    return list(np.log(shape(kn) / shape(519) * 8 * np.exp(-0.9 * np.clip(kn - 500, 0, None) / 50)))


def main():
    bases = [r for r in reversed(cec)][:BASES]
    keep = {r["date"] for r in bases}
    result = {"fittedThrough": cec[-1]["date"], "from": EXPORT_LO, "variants": [], "bases": []}
    stocks = {}
    for v in VARIANTS:
        knots = v.get("knots", KNOTS)
        lam_fixed, bw = v.get("lam"), v.get("band_weight", 1.0)
        x0 = start_point(knots) + ([] if lam_fixed is not None else [0.08]) + [0.05]
        step = [0.4] * len(knots) + ([] if lam_fixed is not None else [0.02]) + [0.2]

        def objective(theta):
            ce, br, *_ = simulate(theta, knots, lam_fixed, bw)
            return float((ce ** 2).sum() + (br ** 2).sum())

        theta = nelder_mead(objective, x0, step)
        ce, br, noncec, rec, lam, g = simulate(theta, knots, lam_fixed, bw, record=keep)
        diag = {
            "key": v["key"], "label": v["label"],
            "cutoffRmse": round(float(np.sqrt((ce ** 2).mean())), 2),
            "cutoffMaxError": round(float(np.abs(ce).max()), 2),
            "draws": len(ce), "snapshots": len(snaps),
            "attritionPerWeek": round(float(lam), 4), "growthPerYear": round(float(g), 3),
            "nonCecPerBand": {b: round(float(n)) for (b, *_), n in zip(BANDS, noncec)},
        }
        result["variants"].append(diag)
        stocks[v["key"]] = rec
        print(f"{v['key']:15} cutoff rmse {diag['cutoffRmse']:.2f} (max {diag['cutoffMaxError']:.2f}) "
              f"attrition {lam:.3f}/wk growth {g:+.2f}/yr non-CEC {diag['nonCecPerBand']}")
    for r in bases:
        result["bases"].append({
            "number": r["number"], "date": r["date"], "poolAsOf": r["poolAsOf"],
            "invitations": r["invitations"], "crsCutoff": r["crsCutoff"],
            "stock": {k: [round(float(x), 1) for x in stocks[k][r["date"]][col(EXPORT_LO):col(EXPORT_HI) + 1]]
                      for k in stocks},
        })
    json.dump(result, open(OUT, "w"), separators=(",", ":"))
    print("wrote", os.path.relpath(OUT), len(result["bases"]), "bases x", len(VARIANTS), "variants")


if __name__ == "__main__":
    main()
