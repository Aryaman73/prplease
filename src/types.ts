/** Shapes emitted by scripts/sync.mjs. Keep in sync with the normalizers there. */

export interface Band {
  label: string;
  min: number;
  max: number;
  parent: string | null;
}

export interface Category {
  key: string;
  label: string;
  count: number;
}

export interface Round {
  number: string;
  date: string;
  name: string;
  category: string;
  categoryLabel: string;
  version: number | null;
  invitations: number | null;
  crsCutoff: number | null;
  publishedAt: string | null;
  /** Null for the ~18% of historical rounds with an unparseable or absent value. */
  tieBreak: string | null;
  tieBreakRaw: string | null;
  poolAsOf: string | null;
  pool: {
    bands: Record<string, number | null>;
    total: number | null;
  };
}

export interface Draws {
  bands: Band[];
  categories: Category[];
  /** Newest first. */
  rounds: Round[];
}

/**
 * Upstream publishes these as human-readable strings ("More than 10 years",
 * "Not enough data"), so every parsed number keeps its original alongside.
 * `known: false` means the string carried no number — show `raw`, never a zero.
 */
export interface Duration {
  raw: string | null;
  days: number | null;
  known: boolean;
}

export interface People {
  raw: string | null;
  count: number | null;
  known: boolean;
}

export interface StreamMonth {
  peopleAhead: People;
  waitTime: Duration;
}

export interface Stream {
  key: string;
  label: string;
  current: Duration;
  totalWaiting: People;
  /** Keyed `YYYY-MM` by month of AOR. */
  byAorMonth: Record<string, StreamMonth | undefined>;
}

export interface Processing {
  updatedUpstream: string | null;
  updateInterval: string | null;
  streams: Stream[];
  federalSkilledTrades: Duration | null;
}

export interface Meta {
  dataChangedAt: string;
  sources: {
    draws: { records: number; url: string };
    processing: { upstreamUpdated: string | null; url: string };
  };
}

/** Shape of public/data/highwage.json, written by research/high-wage/build_site_data.py. */
export type WageTier = '2.0x' | '1.5x' | '1.3x';

export interface Occupation {
  noc: string;
  title: string;
  /** Null when the unit group is not on IRCC's high-wage list. */
  tier: WageTier | null;
}

/** Share of reachable candidates in each tier; `none` is the remainder. Sums to 1. */
export type TierShares = Record<WageTier | 'none', number>;

export interface SharePreset {
  key: string;
  label: string;
  note: string;
  shares: TierShares;
}

export interface HighWage {
  effective: string;
  listPublished: string;
  listUrl: string;
  changesUrl: string;
  points: {
    /** High-wage bonus, added to work-length points. */
    experience: Record<WageTier, number>;
    /** Job offer points — instead of work-length + bonus, not on top. */
    offer: Record<WageTier, number>;
  };
  occupations: Occupation[];
  presets: SharePreset[];
  defaultPreset: string;
}
