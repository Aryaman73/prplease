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

/** One pre-change CEC round with its modelled CEC stock (research/high-wage/stockflow.py). */
export interface StockBase {
  number: string;
  date: string;
  poolAsOf: string | null;
  invitations: number;
  crsCutoff: number;
  /** CEC candidates per CRS point from `HighWage.stockflow.from` upward, by fitted variant. */
  stock: Record<string, number[]>;
}

export interface StockFit {
  key: string;
  label: string;
  cutoffRmse: number;
  cutoffMaxError: number;
  draws: number;
  snapshots: number;
  attritionPerWeek: number;
  growthPerYear: number;
  nonCecPerBand: Record<string, number>;
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
  stockflow: {
    fittedThrough: string;
    from: number;
    variants: StockFit[];
    /** Newest first. */
    bases: StockBase[];
  };
}

/** Shape of public/data/admissions.json, written by scripts/admissions.mjs. */
export type AdmissionsKey = 'total' | 'economic' | 'fhs' | 'pnp' | 'family' | 'refugees' | 'humanitarian';

export interface PlanFigure {
  /** Null where a plan published a range only (2015). */
  target: number | null;
  low: number | null;
  high: number | null;
}

/** A plan's figures for one year. Null where the plan set none for that category. */
export type PlanYear = Record<AdmissionsKey, PlanFigure | null>;

export interface AdmissionsYear {
  year: number;
  /** 12 for a complete year, fewer for the year in progress, 0 for future years. */
  monthsReported: number;
  actual: Record<AdmissionsKey, number> | null;
  /** The same months of the previous year, only for a partial year. */
  priorSamePeriod: Record<AdmissionsKey, number> | null;
  target: { plan: string; notional: boolean; values: PlanYear } | null;
  /** Every plan that set a figure for this year, oldest first. */
  versions: { plan: string; tabled: string; values: PlanYear }[];
}

export interface Admissions {
  source: { url: string; dataset: string; asOf: string | null; through: string };
  categories: { key: AdmissionsKey; label: string }[];
  months: string[];
  monthly: Record<AdmissionsKey, number[]>;
  years: AdmissionsYear[];
  plans: { key: string; tabled: string; url: string; notes: string[] }[];
}
