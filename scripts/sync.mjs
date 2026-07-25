/**
 * prplease — IRCC data sync.
 *
 * Zero runtime dependencies. This runs unattended on a cron for years, and every
 * dependency added here is a future failure mode. Node >= 18 (global fetch) is all
 * it needs, so there is no build step and no lockfile drift between us and the runner.
 *
 * Deliberately not type-checked, and excluded from tsconfig. Everything this file
 * touches is untrusted JSON of a shape that changes without notice, so static types
 * over it would describe an assumption rather than a fact. The runtime assertions
 * below are the actual safety mechanism: they fail the run loudly on drift, which
 * a type annotation cannot do.
 *
 * Reads three upstream feeds, asserts their shape, normalizes them, and writes
 * public/data/*.json. Also appends a dated snapshot to data/history/ — IRCC only
 * publishes *current* processing times, so the series only exists if we keep it.
 *
 * Exit codes: 0 = success (data may or may not have changed), 1 = upstream schema
 * drift or fetch failure. On failure nothing is written, so the last-good data stands.
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'public', 'data');
const HISTORY_DIR = join(ROOT, 'data', 'history');
const TIMELINES_CSV = join(ROOT, 'data', 'timelines.csv');

const SOURCES = {
  rounds: 'https://www.canada.ca/content/dam/ircc/documents/json/ee_rounds_123_en.json',
  flpt: 'https://www.canada.ca/content/dam/ircc/documents/json/flpt-en.json',
  ptime: 'https://www.canada.ca/content/dam/ircc/documents/json/data-ptime-non-country-en.json',
};

/**
 * CRS pool distribution bands. Order and labels verified against the rendered
 * rounds-invitations page — the feed ships these as opaque dd1..dd18 keys.
 *
 * dd3 and dd9 are parent rows: their sub-bands sum to them. dd18 is the grand total
 * of the seven top-level bands. Both invariants are asserted below.
 */
const CRS_BANDS = [
  { key: 'dd1', label: '601-1200', min: 601, max: 1200, parent: null },
  { key: 'dd2', label: '501-600', min: 501, max: 600, parent: null },
  { key: 'dd3', label: '451-500', min: 451, max: 500, parent: null },
  { key: 'dd4', label: '491-500', min: 491, max: 500, parent: 'dd3' },
  { key: 'dd5', label: '481-490', min: 481, max: 490, parent: 'dd3' },
  { key: 'dd6', label: '471-480', min: 471, max: 480, parent: 'dd3' },
  { key: 'dd7', label: '461-470', min: 461, max: 470, parent: 'dd3' },
  { key: 'dd8', label: '451-460', min: 451, max: 460, parent: 'dd3' },
  { key: 'dd9', label: '401-450', min: 401, max: 450, parent: null },
  { key: 'dd10', label: '441-450', min: 441, max: 450, parent: 'dd9' },
  { key: 'dd11', label: '431-440', min: 431, max: 440, parent: 'dd9' },
  { key: 'dd12', label: '421-430', min: 421, max: 430, parent: 'dd9' },
  { key: 'dd13', label: '411-420', min: 411, max: 420, parent: 'dd9' },
  { key: 'dd14', label: '401-410', min: 401, max: 410, parent: 'dd9' },
  { key: 'dd15', label: '351-400', min: 351, max: 400, parent: null },
  { key: 'dd16', label: '301-350', min: 301, max: 350, parent: null },
  { key: 'dd17', label: '0-300', min: 0, max: 300, parent: null },
];
const TOP_LEVEL_BANDS = CRS_BANDS.filter((b) => b.parent === null).map((b) => b.key);
const TOTAL_BAND = 'dd18';

/**
 * Draw categories. `drawName` is free text that IRCC extends without warning
 * (a "Skilled Military Recruits" category appeared in 2026), so exact program
 * names are matched first and everything else falls through keyword rules.
 * Anything unmatched lands in `uncategorized` and is surfaced in meta.json rather
 * than silently absorbed into a default bucket.
 */
const EXACT_CATEGORIES = new Map([
  ['no program specified', 'general'],
  ['general', 'general'],
  ['provincial nominee program', 'pnp'],
  ['canadian experience class', 'cec'],
  ['federal skilled worker', 'fsw'],
  ['federal skilled trades', 'fst'],
]);

// Ordered: the first match wins, so narrow occupation categories precede broad ones.
const KEYWORD_CATEGORIES = [
  [/french/, 'french'],
  [/physician/, 'physicians'],
  [/senior manager/, 'senior-managers'],
  [/military/, 'military'],
  [/healthcare|health care|social services/, 'healthcare'],
  [/\bstem\b/, 'stem'],
  [/transport/, 'transport'],
  [/agri/, 'agriculture'],
  [/education/, 'education'],
  [/trade/, 'trades'],
];

const CATEGORY_LABELS = {
  general: 'General',
  pnp: 'Provincial Nominee Program',
  cec: 'Canadian Experience Class',
  fsw: 'Federal Skilled Worker',
  fst: 'Federal Skilled Trades',
  french: 'French language proficiency',
  healthcare: 'Healthcare and social services',
  stem: 'STEM occupations',
  trades: 'Trade occupations',
  transport: 'Transport occupations',
  agriculture: 'Agriculture and agri-food',
  education: 'Education occupations',
  physicians: 'Physicians',
  'senior-managers': 'Senior managers',
  military: 'Skilled military recruits',
  uncategorized: 'Uncategorized',
};

/**
 * Express Entry streams within the processing-times feed. The feed carries 28
 * streams across all of Canadian immigration; the other 24 are dropped here rather
 * than at render time so the shipped payload stays small.
 *
 * Note there is no separate FST stream upstream — it lives in the non-country feed
 * and is usually "Not enough data".
 */
const EE_STREAMS = [
  { key: 'cec', label: 'Canadian Experience Class' },
  { key: 'fsw', label: 'Federal Skilled Worker' },
  { key: 'pnp-ee', label: 'Provincial Nominee (Express Entry)' },
  { key: 'pnp-base', label: 'Provincial Nominee (base, non-EE)' },
];

/** Application stages, in the order they must occur. `adr` is deliberately absent. */
const STAGES = [
  'ita', 'aor', 'bil', 'biometrics', 'medical',
  'eligibility', 'p1', 'p2', 'copr',
];

const MONTHS = new Map(
  ['january', 'february', 'march', 'april', 'may', 'june', 'july',
    'august', 'september', 'october', 'november', 'december']
    .map((m, i) => [m, i]),
);

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

class SchemaError extends Error {}

/** Fetch JSON with retries. Transient 5xx/network blips should not page anyone. */
async function fetchJson(url, attempts = 3) {
  let lastError;
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(url, {
        headers: { 'user-agent': 'prplease-sync (+https://aryamans.me/prplease)' },
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      // canada.ca serves an HTML error page with a 200 in some edge cases.
      if (!text.trimStart().startsWith('{')) {
        throw new Error(`expected JSON, got ${text.trimStart().slice(0, 40)}…`);
      }
      return JSON.parse(text);
    } catch (err) {
      lastError = err;
      if (i < attempts) await new Promise((r) => setTimeout(r, 1000 * i));
    }
  }
  throw new Error(`fetch failed after ${attempts} attempts: ${url} — ${lastError?.message}`);
}

// ---------------------------------------------------------------------------
// Tolerant parsers
//
// Upstream values are formatted for humans, not machines. Every parser here
// returns null rather than throwing, and callers keep the raw string so the UI can
// always fall back to displaying exactly what IRCC published.
// ---------------------------------------------------------------------------

/** "5,000" -> 5000, "" -> null. */
function toInt(value) {
  if (typeof value !== 'string') return typeof value === 'number' ? value : null;
  const cleaned = value.replace(/[,\s]/g, '');
  if (!cleaned || !/^-?\d+$/.test(cleaned)) return null;
  return Number.parseInt(cleaned, 10);
}

/** Strip the anchor tags IRCC embeds in several "text" fields. */
function stripHtml(value) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parse IRCC's timestamp strings into ISO 8601.
 *
 * Roughly 20% of historical `drawCutOff` values deviate from the nominal
 * "Month DD, YYYY at HH:MM:SS UTC" format: single-digit days, double spaces,
 * "." instead of ",", a stray "AM"/"PM" appended to a 24-hour clock, a missing
 * "at", a missing "UTC", and at least one row with no year at all. We normalize
 * what we can and return null for the rest.
 */
function parseTimestamp(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const cleaned = value
    .replace(/ /g, ' ')
    .replace(/\./g, ' ')               // "March 02. 2024" — a stray period for a comma
    .replace(/\bat\b/gi, ' ')
    .replace(/\bUTC\b/gi, ' ')
    .replace(/\b[AP]M\b/gi, ' ')       // times are already 24-hour; the meridiem is noise
    .replace(/,/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const m = cleaned.match(/^(\p{L}+)\s+(\d{1,2})\s+(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})$/u);
  if (!m) return null;

  const month = MONTHS.get(m[1].toLowerCase());
  if (month === undefined) return null;

  const [day, year, hour, min, sec] = [m[2], m[3], m[4], m[5], m[6]].map(Number);
  if (day < 1 || day > 31 || hour > 23 || min > 59 || sec > 59) return null;

  const date = new Date(Date.UTC(year, month, day, hour, min, sec));
  // Rejects impossible dates that Date.UTC would silently roll over (e.g. Feb 31).
  if (date.getUTCDate() !== day || date.getUTCMonth() !== month) return null;
  return date.toISOString();
}

/**
 * Processing-time strings ("About 6 months", "More than 10 years",
 * "Not enough data") into approximate days, keeping the original for display.
 */
function parseDuration(value) {
  if (typeof value !== 'string' || !value.trim()) return { raw: null, days: null, known: false };
  const raw = value.trim();
  const m = raw.match(/(\d[\d,]*)\s*(minute|hour|day|week|month|year)/i);
  if (!m) return { raw, days: null, known: false };
  const n = toInt(m[1]);
  if (n === null) return { raw, days: null, known: false };
  const perUnit = {
    minute: 1 / 1440, hour: 1 / 24, day: 1, week: 7, month: 30.44, year: 365.25,
  }[m[2].toLowerCase()];
  return { raw, days: Math.round(n * perUnit), known: true };
}

/** "About 61,500 people waiting" / "Less than 100 people ahead of you" -> number. */
function parsePeople(value) {
  if (typeof value !== 'string' || !value.trim()) return { raw: null, count: null, known: false };
  const raw = value.trim();
  const m = raw.match(/(\d[\d,]*)/);
  const count = m ? toInt(m[1]) : null;
  return { raw, count, known: count !== null };
}

function categorize(drawName) {
  const name = stripHtml(drawName).toLowerCase().trim();
  const exact = EXACT_CATEGORIES.get(name);
  if (exact) return exact;
  for (const [pattern, category] of KEYWORD_CATEGORIES) {
    if (pattern.test(name)) return category;
  }
  return 'uncategorized';
}

/** "French-Language proficiency 2026-Version 2" -> 2 */
function parseVersion(drawName) {
  const m = stripHtml(drawName).match(/version\s*(\d+)/i);
  return m ? Number.parseInt(m[1], 10) : null;
}

/** Draw numbers are mostly integers but include "91a"/"91b". Sort stably regardless. */
function drawSortKey(drawNumber) {
  const m = String(drawNumber).match(/^(\d+)([a-z]*)$/i);
  if (!m) return { n: 0, suffix: String(drawNumber) };
  return { n: Number.parseInt(m[1], 10), suffix: m[2].toLowerCase() };
}

// ---------------------------------------------------------------------------
// Normalizers
// ---------------------------------------------------------------------------

function assert(condition, message) {
  if (!condition) throw new SchemaError(message);
}

function normalizeRounds(raw) {
  assert(raw && typeof raw === 'object', 'rounds: payload is not an object');
  assert(Array.isArray(raw.rounds), 'rounds: missing `rounds` array');
  assert(raw.rounds.length > 400, `rounds: expected >400 rounds, got ${raw.rounds.length}`);

  const required = ['drawNumber', 'drawDate', 'drawName', 'drawSize', 'drawCRS'];
  for (const field of required) {
    assert(field in raw.rounds[0], `rounds: newest round is missing \`${field}\``);
  }
  for (const band of CRS_BANDS) {
    assert(band.key in raw.rounds[0], `rounds: newest round is missing band \`${band.key}\``);
  }

  const warnings = { uncategorized: new Set(), bandMismatches: [], unparsedCutoffs: 0 };

  const rounds = raw.rounds.map((r) => {
    const bands = {};
    for (const band of CRS_BANDS) bands[band.label] = toInt(r[band.key]);
    const total = toInt(r[TOTAL_BAND]);

    // Verify the published sub-band arithmetic. IRCC has shipped at least one
    // transposition typo (draw 247), so mismatches are recorded, not fatal.
    for (const parent of ['dd3', 'dd9']) {
      const children = CRS_BANDS.filter((b) => b.parent === parent);
      const parentValue = toInt(r[parent]);
      const childValues = children.map((b) => toInt(r[b.key]));
      if (parentValue === null || childValues.some((v) => v === null)) continue;
      const sum = childValues.reduce((a, b) => a + b, 0);
      if (sum !== parentValue) {
        warnings.bandMismatches.push({
          draw: String(r.drawNumber), date: r.drawDate, band: parent,
          published: parentValue, sumOfSubBands: sum, delta: sum - parentValue,
        });
      }
    }

    // The seven top-level bands must account for the whole pool.
    const topLevel = TOP_LEVEL_BANDS.map((k) => toInt(r[k]));
    if (total !== null && !topLevel.some((v) => v === null)) {
      const sum = topLevel.reduce((a, b) => a + b, 0);
      if (sum !== total) {
        warnings.bandMismatches.push({
          draw: String(r.drawNumber), date: r.drawDate, band: TOTAL_BAND,
          published: total, sumOfSubBands: sum, delta: sum - total,
        });
      }
    }

    const category = categorize(r.drawName);
    if (category === 'uncategorized') warnings.uncategorized.add(stripHtml(r.drawName));

    const cutoffRaw = typeof r.drawCutOff === 'string' ? r.drawCutOff.trim() : '';
    const tieBreak = parseTimestamp(cutoffRaw);
    if (cutoffRaw && !tieBreak) warnings.unparsedCutoffs++;

    return {
      number: String(r.drawNumber),
      date: r.drawDate,
      name: stripHtml(r.drawName),
      category,
      categoryLabel: CATEGORY_LABELS[category] ?? CATEGORY_LABELS.uncategorized,
      version: parseVersion(r.drawName),
      invitations: toInt(r.drawSize),
      crsCutoff: toInt(r.drawCRS),
      publishedAt: parseTimestamp(r.drawDateTime),
      // The tie-break rule: candidates at the cutoff score who entered the pool
      // before this timestamp were invited. Null for ~18% of historical rounds.
      tieBreak,
      tieBreakRaw: cutoffRaw || null,
      poolAsOf: r.drawDistributionAsOn || null,
      pool: { bands, total },
    };
  });

  // Newest first, matching upstream, but enforced rather than assumed.
  rounds.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    const ka = drawSortKey(a.number); const kb = drawSortKey(b.number);
    return kb.n - ka.n || kb.suffix.localeCompare(ka.suffix);
  });

  assert(
    warnings.bandMismatches.length <= 5,
    `rounds: ${warnings.bandMismatches.length} band-sum mismatches — upstream schema likely changed`,
  );

  const categories = [...new Set(rounds.map((r) => r.category))].sort().map((key) => ({
    key, label: CATEGORY_LABELS[key] ?? key,
    count: rounds.filter((r) => r.category === key).length,
  }));

  return {
    data: {
      bands: CRS_BANDS.map(({ key, ...rest }) => rest),
      categories,
      rounds,
    },
    warnings: {
      uncategorizedDrawNames: [...warnings.uncategorized].sort(),
      bandSumMismatches: warnings.bandMismatches,
      unparsedTieBreaks: warnings.unparsedCutoffs,
    },
  };
}

function normalizeProcessing(flpt, ptime) {
  assert(flpt && typeof flpt === 'object', 'flpt: payload is not an object');
  for (const key of ['current-flpt', 'total-people', 'people-ahead', 'default-update']) {
    assert(key in flpt, `flpt: missing \`${key}\``);
  }
  assert(
    Object.keys(flpt['people-ahead']).length > 1000,
    'flpt: people-ahead is unexpectedly small',
  );

  const keyPattern = /^[a-z0-9-]+-\d{4}\/\d{2}$/;
  const badKeys = Object.keys(flpt['people-ahead']).filter((k) => !keyPattern.test(k));
  assert(badKeys.length === 0, `flpt: ${badKeys.length} malformed people-ahead keys (${badKeys.slice(0, 3)})`);

  const streams = EE_STREAMS.map(({ key, label }) => {
    assert(key in flpt['current-flpt'], `flpt: expected stream \`${key}\` is absent`);

    // people-ahead / wait-times are keyed `<stream>-YYYY/MM` by AOR month.
    const byMonth = {};
    const prefix = `${key}-`;
    for (const [k, v] of Object.entries(flpt['people-ahead'])) {
      if (!k.startsWith(prefix)) continue;
      const month = k.slice(prefix.length);
      if (!/^\d{4}\/\d{2}$/.test(month)) continue;
      byMonth[month.replace('/', '-')] = {
        peopleAhead: parsePeople(v),
        waitTime: parseDuration(flpt['wait-times']?.[k] ?? ''),
      };
    }

    return {
      key,
      label,
      current: parseDuration(flpt['current-flpt'][key]),
      totalWaiting: parsePeople(flpt['total-people']?.[key] ?? ''),
      byAorMonth: byMonth,
    };
  });

  // FST has no stream of its own upstream; it lives in the non-country feed.
  const fst = ptime?.fed_skilled_trades?.skilled_trades_ee ?? null;

  return {
    data: {
      updatedUpstream: flpt['default-update']?.flpt_lastupdated ?? null,
      updateInterval: flpt['default-update']?.flpt_interval ?? null,
      streams,
      federalSkilledTrades: fst ? parseDuration(fst) : null,
    },
    upstreamUpdated: flpt['default-update']?.flpt_lastupdated ?? null,
  };
}

// ---------------------------------------------------------------------------
// Community timelines (hand-curated CSV -> aggregates only)
//
// We publish percentiles, never raw rows: the aggregate is the interesting part,
// and it avoids republishing anyone else's dataset verbatim.
// ---------------------------------------------------------------------------

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  if (lo === hi) return Math.round(sorted[lo]);
  return Math.round(sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo));
}

async function normalizeTimelines() {
  let text;
  try {
    text = await readFile(TIMELINES_CSV, 'utf8');
  } catch {
    return { data: { rows: 0, stages: [], byAorMonth: [] }, warnings: { timelineErrors: [] } };
  }

  const rows = parseCsv(text);
  if (rows.length < 2) return { data: { rows: 0, stages: [], byAorMonth: [] }, warnings: { timelineErrors: [] } };

  const header = rows[0].map((h) => h.trim());
  const errors = [];
  const records = [];

  rows.slice(1).forEach((cells, i) => {
    const lineNo = i + 2; // 1-indexed, plus the header row
    const rec = Object.fromEntries(header.map((h, j) => [h, (cells[j] ?? '').trim()]));

    if (!rec.aor_date) { errors.push({ line: lineNo, error: 'aor_date is required (it anchors every gap)' }); return; }

    const dates = {};
    let invalid = false;
    for (const stage of [...STAGES, 'adr']) {
      const value = rec[`${stage}_date`];
      if (!value) continue;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        errors.push({ line: lineNo, error: `${stage}_date "${value}" is not YYYY-MM-DD` });
        invalid = true; continue;
      }
      const t = Date.parse(`${value}T00:00:00Z`);
      if (Number.isNaN(t)) { errors.push({ line: lineNo, error: `${stage}_date "${value}" is not a real date` }); invalid = true; continue; }
      if (t > Date.now()) { errors.push({ line: lineNo, error: `${stage}_date "${value}" is in the future` }); invalid = true; continue; }
      dates[stage] = t;
    }
    if (invalid) return;

    // Stages must not go backwards. ADR is excluded: it can land at any point.
    let previous = -Infinity, previousStage = null;
    for (const stage of STAGES) {
      if (!(stage in dates)) continue;
      if (dates[stage] < previous) {
        errors.push({ line: lineNo, error: `${stage}_date precedes ${previousStage}_date` });
        invalid = true; break;
      }
      previous = dates[stage]; previousStage = stage;
    }
    if (invalid) return;

    records.push({ stream: rec.stream || 'unknown', dates });
  });

  const DAY = 86_400_000;
  const aorMonth = (t) => new Date(t).toISOString().slice(0, 7);

  const stages = STAGES.filter((s) => s !== 'aor').concat('adr').map((stage) => {
    // Gaps are signed: ITA precedes AOR, so its median is legitimately negative.
    // Ordering is already enforced during validation, so no filtering is needed here.
    const gaps = records
      .filter((r) => stage in r.dates)
      .map((r) => (r.dates[stage] - r.dates.aor) / DAY)
      .sort((a, b) => a - b);
    return {
      stage, samples: gaps.length,
      p25: percentile(gaps, 0.25), median: percentile(gaps, 0.5), p75: percentile(gaps, 0.75),
    };
  });

  const months = new Map();
  for (const r of records) {
    const m = aorMonth(r.dates.aor);
    if (!months.has(m)) months.set(m, []);
    months.get(m).push(r);
  }

  const byAorMonth = [...months.entries()].sort().map(([month, recs]) => ({
    month, samples: recs.length,
    stages: STAGES.filter((s) => s !== 'aor').map((stage) => {
      const gaps = recs.filter((r) => stage in r.dates)
        .map((r) => (r.dates[stage] - r.dates.aor) / DAY)
        .sort((a, b) => a - b);
      return { stage, samples: gaps.length, median: percentile(gaps, 0.5) };
    }).filter((s) => s.samples > 0),
  }));

  return {
    data: { rows: records.length, stages, byAorMonth },
    warnings: { timelineErrors: errors },
  };
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/** Stable stringify: sorted object keys so git diffs show real changes only. */
function stableStringify(value, indent = 2) {
  const sort = (v) => {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === 'object') {
      return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sort(v[k])]));
    }
    return v;
  };
  return `${JSON.stringify(sort(value), null, indent)}\n`;
}

function hash(text) {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

async function writeJson(path, value) {
  const text = stableStringify(value);
  await mkdir(dirname(path), { recursive: true });
  let existing = null;
  try { existing = await readFile(path, 'utf8'); } catch { /* first run */ }
  if (existing === text) return { path, changed: false, hash: hash(text) };
  await writeFile(path, text, 'utf8');
  return { path, changed: true, hash: hash(text) };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const startedAt = new Date().toISOString();
  console.log(`[sync] starting ${startedAt}`);

  const [roundsRaw, flptRaw, ptimeRaw] = await Promise.all([
    fetchJson(SOURCES.rounds),
    fetchJson(SOURCES.flpt),
    fetchJson(SOURCES.ptime),
  ]);
  console.log('[sync] fetched all three sources');

  const rounds = normalizeRounds(roundsRaw);
  const processing = normalizeProcessing(flptRaw, ptimeRaw);
  const timelines = await normalizeTimelines();
  console.log(`[sync] normalized ${rounds.data.rounds.length} rounds, ${processing.data.streams.length} streams, ${timelines.data.rows} timelines`);

  const written = await Promise.all([
    writeJson(join(OUT_DIR, 'draws.json'), rounds.data),
    writeJson(join(OUT_DIR, 'processing.json'), processing.data),
    writeJson(join(OUT_DIR, 'timelines.json'), timelines.data),
  ]);

  // Daily snapshot of processing times. IRCC publishes only current values, so
  // this file is the only place the series will ever exist. Named by UTC date;
  // re-running on the same day overwrites rather than accumulating duplicates.
  const today = startedAt.slice(0, 10);
  await writeJson(join(HISTORY_DIR, 'processing', `${today}.json`), {
    capturedOn: today,
    upstreamUpdated: processing.data.updatedUpstream,
    streams: processing.data.streams.map((s) => ({
      key: s.key,
      current: s.current,
      totalWaiting: s.totalWaiting,
    })),
  });

  let snapshotCount = 0;
  try {
    snapshotCount = (await readdir(join(HISTORY_DIR, 'processing'))).filter((f) => f.endsWith('.json')).length;
  } catch { /* first run */ }

  const dataChanged = written.some((w) => w.changed);

  // `dataChangedAt` only moves when content actually moves, so meta.json is stable
  // on no-op runs and the cron produces no empty commits. The workflow run history
  // is the record of *checks*; this file records *changes*.
  let previousMeta = {};
  try { previousMeta = JSON.parse(await readFile(join(OUT_DIR, 'meta.json'), 'utf8')); } catch { /* first run */ }

  const meta = {
    generator: 'scripts/sync.mjs',
    dataChangedAt: dataChanged ? startedAt : (previousMeta.dataChangedAt ?? startedAt),
    sources: {
      draws: { url: SOURCES.rounds, records: rounds.data.rounds.length, hash: written[0].hash },
      processing: {
        url: SOURCES.flpt, upstreamUpdated: processing.upstreamUpdated,
        streams: processing.data.streams.length, hash: written[1].hash,
      },
      timelines: { source: 'data/timelines.csv (hand-curated)', records: timelines.data.rows, hash: written[2].hash },
    },
    history: { processingSnapshots: snapshotCount },
    warnings: { ...rounds.warnings, ...timelines.warnings },
  };
  await writeJson(join(OUT_DIR, 'meta.json'), meta);

  // Surface anything that needs a human. None of these are fatal, but silent
  // drift is how this project would quietly start lying.
  const { uncategorizedDrawNames, bandSumMismatches, unparsedTieBreaks, timelineErrors } = meta.warnings;
  if (uncategorizedDrawNames.length) {
    console.warn(`[warn] ${uncategorizedDrawNames.length} uncategorized draw name(s) — add a rule in KEYWORD_CATEGORIES:`);
    for (const n of uncategorizedDrawNames) console.warn(`         "${n}"`);
  }
  if (bandSumMismatches.length) {
    console.warn(`[warn] ${bandSumMismatches.length} CRS band-sum mismatch(es) in upstream data:`);
    for (const m of bandSumMismatches) {
      console.warn(`         draw ${m.draw} (${m.date}) ${m.band}: published ${m.published}, sub-bands sum to ${m.sumOfSubBands}`);
    }
  }
  if (unparsedTieBreaks) console.warn(`[warn] ${unparsedTieBreaks} tie-break timestamp(s) unparseable — raw string retained`);
  if (timelineErrors.length) {
    console.warn(`[warn] ${timelineErrors.length} timeline row(s) rejected:`);
    for (const e of timelineErrors) console.warn(`         data/timelines.csv:${e.line} — ${e.error}`);
  }

  console.log(`[sync] ${dataChanged ? 'data changed' : 'no changes'} — ${snapshotCount} processing snapshot(s) on file`);
}

main().catch((err) => {
  if (err instanceof SchemaError) {
    console.error(`\n[FATAL] Upstream schema drift: ${err.message}`);
    console.error('        Nothing was written; the last-good data still stands.');
    console.error('        Inspect the feed and update scripts/sync.mjs before this can pass.\n');
  } else {
    console.error(`\n[FATAL] ${err.message}\n`);
  }
  process.exit(1);
});
