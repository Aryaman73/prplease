import type { HighWage, StockBase, TierShares, WageTier } from '../types';

/**
 * Cutoff projection for the high-wage occupation points (in effect 3 Nov 2026).
 *
 * The CEC stock — CEC candidates per CRS point at each pre-change CEC round — comes
 * from research/high-wage/stockflow.py, which simulates daily CEC inflow, draws,
 * expiry and attrition, fitted to every CEC cutoff and IRCC's pool bands since June
 * 2025. It replaces spreading IRCC's banded snapshot evenly with one CEC share at
 * every score, which put far too few CEC candidates just below the cutoff: CEC draws
 * drain everyone above it every two weeks, so they pile up underneath.
 *
 * For each fitted variant:
 *  1. Move the stock by the few points the fit misses this round's real cutoff, so
 *     "today" reproduces the actual draw exactly.
 *  2. Shift each score by its tier's high-wage experience bonus and find where the
 *     same draw size lands.
 * The headline uses the central fit; the range spans every variant with the listed
 * tiers' shares scaled by 0.8, 1 and 1.2, since those shares are the larger unknown.
 *
 * Job offers are deliberately absent. The new Labour Market Integration factor
 * pays the higher of (work-length + high-wage bonus) and a job offer, never both.
 * Everyone a CEC draw reaches has 1+ year of Canadian experience, so at least 35
 * work-length points, and an offer pays exactly 30 more than the same tier's
 * bonus — so for them an offer in their own tier never wins.
 *
 * Tiers are assumed independent of score, and this is the first draw only: no
 * new profiles, no change in draw size.
 */

export const TIERS: readonly (WageTier | 'none')[] = ['2.0x', '1.5x', '1.3x', 'none'];

const MAX_SCORE = 800;
const CENTRAL = 'central';
const SHARE_SCALES = [0.8, 1, 1.2];

function sumFrom(n: Float64Array, from: number): number {
  let total = 0;
  for (let s = Math.max(0, from); s <= MAX_SCORE; s++) total += n[s]!;
  return total;
}

/** Lowest score at which candidates at or above it reach `size`. */
export function cutoffFor(n: Float64Array, size: number): number {
  // The tolerance absorbs float error from summing in a different order than the
  // counts were calibrated in; without it a draw could land one point low.
  const target = size * (1 - 1e-9);
  let running = 0;
  for (let s = MAX_SCORE; s >= 0; s--) {
    running += n[s]!;
    if (running >= target) return s;
  }
  return 0;
}

/** A variant's per-point stock on the full 0–800 scale, moved by `offset` points. */
function place(values: number[], from: number, offset = 0): Float64Array {
  const n = new Float64Array(MAX_SCORE + 1);
  values.forEach((v, i) => {
    const s = from + i + offset;
    if (s >= 0 && s <= MAX_SCORE) n[s] = v;
  });
  return n;
}

function shift(hw: HighWage, n: Float64Array, shares: TierShares, byTier?: Record<WageTier | 'none', Float64Array>) {
  const out = new Float64Array(MAX_SCORE + 1);
  for (let s = 0; s <= MAX_SCORE; s++) {
    const count = n[s]!;
    if (!count) continue;
    for (const tier of TIERS) {
      const v = count * shares[tier];
      if (!v) continue;
      const to = Math.min(MAX_SCORE, s + (tier === 'none' ? 0 : hw.points.experience[tier]));
      out[to]! += v;
      if (byTier) byTier[tier][to]! += v;
    }
  }
  return out;
}

/** Listed tiers scaled by `k`, with `none` taking up the difference. */
function scaleListed(shares: TierShares, k: number): TierShares {
  const listed = shares['2.0x'] + shares['1.5x'] + shares['1.3x'];
  const f = listed * k > 1 ? 1 / listed : k;
  const a = shares['2.0x'] * f;
  const b = shares['1.5x'] * f;
  const c = shares['1.3x'] * f;
  return { '2.0x': a, '1.5x': b, '1.3x': c, none: Math.max(0, 1 - a - b - c) };
}

export interface ProjectionInput {
  base: StockBase;
  shares: TierShares;
  /** Defaults to the round's own invitation count. */
  size?: number;
}

export interface Projection {
  before: number;
  after: number;
  /** Spread of `after` across fitted variants and listed shares ×0.8 / ×1 / ×1.2. */
  low: number;
  high: number;
  size: number;
  /** CEC candidates per CRS point (central fit), before and after the bonus. */
  today: Float64Array;
  shifted: Float64Array;
  /** CEC candidates invited at the new cutoff, by tier; sums to `size`. */
  invitedByTier: Record<WageTier | 'none', number>;
}

export function project(hw: HighWage, input: ProjectionInput): Projection {
  const { base, shares } = input;
  const from = hw.stockflow.from;
  const size = input.size ?? base.invitations;

  // Calibrate each variant so it reproduces the real draw, then project.
  const calibrated = (values: number[]) => {
    const raw = place(values, from);
    return place(values, from, base.crsCutoff - cutoffFor(raw, base.invitations));
  };

  const afters: number[] = [];
  for (const values of Object.values(base.stock)) {
    const n = calibrated(values);
    for (const k of SHARE_SCALES) afters.push(cutoffFor(shift(hw, n, scaleListed(shares, k)), size));
  }

  const today = calibrated(base.stock[CENTRAL] ?? Object.values(base.stock)[0]!);
  const byTier = Object.fromEntries(TIERS.map((t) => [t, new Float64Array(MAX_SCORE + 1)])) as Record<
    WageTier | 'none',
    Float64Array
  >;
  const shifted = shift(hw, today, shares, byTier);
  const after = cutoffFor(shifted, size);
  // A tie-break fills the draw from the people on the cutoff score, so only the share
  // of them it reaches is invited, from each tier alike. The tiers then sum to `size`.
  const atCutoff = shifted[after]!;
  const tieShare = atCutoff > 0 ? Math.min(1, Math.max(0, (size - sumFrom(shifted, after + 1)) / atCutoff)) : 0;
  const invitedByTier = Object.fromEntries(
    TIERS.map((t) => [t, sumFrom(byTier[t], after + 1) + byTier[t][after]! * tieShare]),
  ) as Record<WageTier | 'none', number>;

  return {
    before: cutoffFor(today, size),
    after,
    low: Math.min(after, ...afters),
    high: Math.max(after, ...afters),
    size,
    today,
    shifted,
    invitedByTier,
  };
}

/** Normalise three listed-tier percentages into shares, with the remainder as `none`. */
export function sharesFromPercents(p20: number, p15: number, p13: number): TierShares {
  const clean = [p20, p15, p13].map((v) => (Number.isFinite(v) && v > 0 ? v : 0));
  const listed = clean[0]! + clean[1]! + clean[2]!;
  const scale = listed > 100 ? 100 / listed : 1;
  const [a, b, c] = clean.map((v) => (v * scale) / 100) as [number, number, number];
  return { '2.0x': a, '1.5x': b, '1.3x': c, none: Math.max(0, 1 - a - b - c) };
}
