import type { HighWage, Round, TierShares, WageTier } from '../types';

/**
 * Cutoff projection for the high-wage occupation points (in effect 3 Nov 2026).
 *
 * Port of research/high-wage/model.py — keep the two in step. The method:
 *
 *  1. Spread a round's banded pool snapshot to one count per CRS point: uniform
 *     inside each band, except 501–600, which decays geometrically from the
 *     491–500 density so the band still sums to IRCC's figure. Frequent CEC draws
 *     drain everything above the cutoff, so the mass sits just above 500.
 *  2. Drop 601+: those are PNP nominees, invited in the PNP draw the day before.
 *  3. "Reach" is the share of candidates the draw can invite (CEC-eligible, for a
 *     CEC draw). IRCC doesn't publish it, so it is solved for: the share at which
 *     this snapshot reproduces the draw's actual cutoff.
 *  4. Shift each score by tier — the experience bonus, or for `offerShare` of
 *     candidates the job-offer bonus — and find where the same draw size lands.
 *
 * Tiers are assumed independent of score, and this is the first draw only: no
 * new profiles, no change in draw size.
 */

export const TIERS: readonly (WageTier | 'none')[] = ['2.0x', '1.5x', '1.3x', 'none'];

const MAX_SCORE = 800;

/** Band labels as sync.mjs keys them in `round.pool.bands`; 501–600 is handled separately. */
const BANDS: readonly [string, number, number][] = [
  ['491-500', 491, 500], ['481-490', 481, 490], ['471-480', 471, 480], ['461-470', 461, 470],
  ['451-460', 451, 460], ['441-450', 441, 450], ['431-440', 431, 440], ['421-430', 421, 430],
  ['411-420', 411, 420], ['401-410', 401, 410], ['351-400', 351, 400], ['301-350', 301, 350],
  ['0-300', 0, 300],
];

/** Per-point candidate counts from a round's snapshot, or null if any band is missing. */
export function density(round: Round): Float64Array | null {
  const bands = round.pool.bands;
  const n = new Float64Array(MAX_SCORE + 1);

  for (const [label, lo, hi] of BANDS) {
    const count = bands[label];
    if (count === null || count === undefined) return null;
    for (let s = lo; s <= hi; s++) n[s]! += count / (hi - lo + 1);
  }

  const top = bands['501-600'];
  const edge = bands['491-500'];
  if (top === null || top === undefined || edge === null || edge === undefined) return null;

  // Geometric decay a·r^i over 100 points, starting at the 491–500 per-point level.
  let a = edge / 10;
  let r = 1;
  if (top >= a * 100) {
    a = top / 100; // the band is denser than its neighbour: no decay fits, so flat
  } else {
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 60; i++) {
      r = (lo + hi) / 2;
      if ((a * (1 - r ** 100)) / (1 - r) < top) lo = r;
      else hi = r;
    }
  }
  for (let i = 0; i < 100; i++) n[501 + i] = a * r ** i;
  return n;
}

function sumFrom(n: Float64Array, from: number): number {
  let total = 0;
  for (let s = Math.max(0, from); s <= MAX_SCORE; s++) total += n[s]!;
  return total;
}

/** Lowest score at which `reach` × candidates at or above it reaches `size`. */
export function cutoffFor(n: Float64Array, reach: number, size: number): number {
  let running = 0;
  for (let s = MAX_SCORE; s >= 0; s--) {
    running += n[s]! * reach;
    if (running >= size) return s;
  }
  return 0;
}

export interface ProjectionInput {
  round: Round;
  shares: TierShares;
  /** 0–1: share of listed-tier candidates who add an employer's job offer. */
  offerShare: number;
  /** Defaults to the round's own invitation count. */
  size?: number;
  /** Defaults to the calibrated reach. */
  reach?: number;
}

export interface Projection {
  before: number;
  after: number;
  size: number;
  reach: number;
  calibratedReach: number;
  /** Candidates per CRS point, before and after the bonus. */
  today: Float64Array;
  shifted: Float64Array;
  /** Reachable candidates at or above the new cutoff, by tier. */
  invitedByTier: Record<WageTier | 'none', number>;
}

export function project(hw: HighWage, input: ProjectionInput): Projection | null {
  const { round, shares, offerShare } = input;
  const today = density(round);
  if (!today || round.crsCutoff === null || round.invitations === null) return null;

  const calibratedReach = Math.min(1, round.invitations / sumFrom(today, round.crsCutoff));
  const reach = input.reach ?? calibratedReach;
  const size = input.size ?? round.invitations;

  const bonus = (tier: WageTier | 'none', offer: boolean) =>
    tier === 'none' ? 0 : offer ? hw.points.offer[tier] : hw.points.experience[tier];

  const shifted = new Float64Array(MAX_SCORE + 1);
  const byTier = Object.fromEntries(TIERS.map((t) => [t, new Float64Array(MAX_SCORE + 1)])) as Record<
    WageTier | 'none',
    Float64Array
  >;

  for (let s = 0; s <= MAX_SCORE; s++) {
    const count = today[s]!;
    if (!count) continue;
    for (const tier of TIERS) {
      for (const [offer, weight] of [[false, 1 - offerShare], [true, offerShare]] as const) {
        const v = count * shares[tier] * weight;
        if (!v) continue;
        const to = Math.min(MAX_SCORE, s + bonus(tier, offer));
        shifted[to]! += v;
        byTier[tier][to]! += v;
      }
    }
  }

  const after = cutoffFor(shifted, reach, size);
  const invitedByTier = Object.fromEntries(
    TIERS.map((t) => [t, sumFrom(byTier[t], after) * reach]),
  ) as Record<WageTier | 'none', number>;

  return {
    before: cutoffFor(today, reach, size),
    after,
    size,
    reach,
    calibratedReach,
    today,
    shifted,
    invitedByTier,
  };
}

/** Bonus for one applicant: experience needs a year in the occupation; an offer pays regardless. */
export function personalBonus(hw: HighWage, tier: WageTier | null, hasYear: boolean, hasOffer: boolean): number {
  if (!tier) return 0;
  const experience = hasYear ? hw.points.experience[tier] : 0;
  return hasOffer ? Math.max(hw.points.offer[tier], experience) : experience;
}

/** Normalise three listed-tier percentages into shares, with the remainder as `none`. */
export function sharesFromPercents(p20: number, p15: number, p13: number): TierShares {
  const clean = [p20, p15, p13].map((v) => (Number.isFinite(v) && v > 0 ? v : 0));
  const listed = clean[0]! + clean[1]! + clean[2]!;
  const scale = listed > 100 ? 100 / listed : 1;
  const [a, b, c] = clean.map((v) => (v * scale) / 100) as [number, number, number];
  return { '2.0x': a, '1.5x': b, '1.3x': c, none: Math.max(0, 1 - a - b - c) };
}
