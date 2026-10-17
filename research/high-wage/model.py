"""Prototype of the cutoff model the calculator implements (kept in sync with calculator.html).

1. Spread the pool snapshot from the draw into per-point counts: uniform inside each band, except 501-600,
   which decays geometrically from the 491-500 density so the band total matches IRCC's count
   (new profiles thin out fast above 500, and CEC draws keep draining everyone above the cutoff).
2. Drop 601+ (PNP nominees, invited in the PNP draw the day before).
3. f = draw size / pool at or above the actual cutoff -> share of candidates the draw could reach.
4. Shift each point's candidates by tier (experience or, for a share, job-offer points) and find the
   score where f * (candidates at or above it) first reaches the draw size again.

Leave offer_share at 0 for CEC draws. IRCC's Labour Market Integration factor pays the higher of
(work-length + high-wage bonus) and a job offer, and every CEC candidate has at least 35 work-length
points, so an offer in their own tier (always bonus + 30) never wins. The site's port drops it.
"""
import json, sys

BANDS = [("dd2", 501, 600), ("dd4", 491, 500), ("dd5", 481, 490), ("dd6", 471, 480), ("dd7", 461, 470),
         ("dd8", 451, 460), ("dd10", 441, 450), ("dd11", 431, 440), ("dd12", 421, 430), ("dd13", 411, 420),
         ("dd14", 401, 410), ("dd15", 351, 400), ("dd16", 301, 350), ("dd17", 0, 300)]
EXP = {"2.0x": 70, "1.5x": 40, "1.3x": 20, "none": 0}
OFFER = {"2.0x": 100, "1.5x": 70, "1.3x": 50, "none": 0}
MAX = 800


def num(v):
    return float(str(v).replace(",", ""))


def density(draw):
    n = [0.0] * (MAX + 1)
    for key, lo, hi in BANDS:
        c = num(draw[key])
        if key == "dd2":
            continue
        for s in range(lo, hi + 1):
            n[s] += c / (hi - lo + 1)
    total, a = num(draw["dd2"]), num(draw["dd4"]) / 10
    if total >= a * 100:  # no decay possible; fall back to uniform
        r = 1.0
        a = total / 100
    else:
        lo_r, hi_r = 0.0, 1.0
        for _ in range(60):
            r = (lo_r + hi_r) / 2
            if a * (1 - r ** 100) / (1 - r) < total:
                lo_r = r
            else:
                hi_r = r
    for i, s in enumerate(range(501, 601)):
        n[s] = a * r ** i
    return n


def above(n, c):
    return sum(n[c:])


def cutoff(n, f, size):
    run = 0.0
    for s in range(MAX, -1, -1):
        run += n[s] * f
        if run >= size:
            return s
    return 0


def simulate(draw, shares, offer_share=0.0, size=None):
    size = size or num(draw["drawSize"])
    c0 = int(num(draw["drawCRS"]))
    n = density(draw)
    f = size / above(n, c0)
    h = [0.0] * (MAX + 1)
    for s, cnt in enumerate(n):
        if not cnt:
            continue
        for t, p in shares.items():
            for pts, w in ((EXP[t], 1 - offer_share), (OFFER[t], offer_share)):
                h[min(MAX, s + pts)] += cnt * p * w
    return {"f": f, "model_cutoff_before": cutoff(n, f, size), "cutoff_after": cutoff(h, f, size)}


if __name__ == "__main__":
    # argv[1]: this folder (for presets.json); argv[2]: IRCC's raw rounds feed
    # (ee_rounds_123_en.json), which carries the pool as dd1..dd18.
    here = sys.argv[1]
    rounds = json.load(open(sys.argv[2]))["rounds"]
    presets = json.load(open(f"{here}/presets.json"))
    cec = [r for r in rounds if r["drawName"].startswith("Canadian Experience Class")][:4]
    for d in cec:
        print(f"\n{d['drawDate']} CEC {d['drawSize']} @ {d['drawCRS']} (pool as of {d['drawDistributionAsOn']})")
        for jo in (0.0, 0.25):
            for p in presets:
                r = simulate(d, p["shares"], jo)
                print(f"  offer {jo:4.0%}  {p['label']:50} f={r['f']:.2f}  -> {r['cutoff_after']}  (+{r['cutoff_after'] - int(num(d['drawCRS']))})")
