/**
 * PR admissions vs. immigration levels plan targets.
 *
 * Two inputs, deliberately kept apart:
 *
 *   - IRCC's monthly "Admissions of Permanent Residents by Province/Territory of
 *     Intended Destination and Immigration Category" workbook, from the Open Data
 *     portal. People who actually *landed* — became permanent residents — in each
 *     month. Not ITAs, not applications, not approvals-in-principle.
 *
 *   - data/levels.json, hand-curated from the levels plan notices. IRCC publishes
 *     these as HTML tables, once a year, in a format that has changed almost every
 *     year since 2015; a scraper would be more fragile than the transcription.
 *
 * Like sync.mjs this has zero dependencies, which means reading .xlsx by hand. An
 * xlsx is a zip of XML; Node ships zlib, and the zip central directory is a fixed
 * binary layout, so a reader for the one sheet we need is ~40 lines. It does not
 * attempt zip64, encryption or multi-disk archives — none of which an IRCC export
 * uses — and fails loudly if it meets one.
 */

import { inflateRawSync } from 'node:zlib';

export const ADMISSIONS_URL =
  'https://www.ircc.canada.ca/opendata-donneesouvertes/data/EN_ODP-PR-ProvImmCat.xlsx';
export const ADMISSIONS_DATASET =
  'https://open.canada.ca/data/en/dataset/f7e5498e-0ad8-4417-85c9-9b8aff9b9eda';

export class AdmissionsError extends Error {}

const fail = (message) => { throw new AdmissionsError(message); };
const check = (condition, message) => { if (!condition) fail(message); };

/** Category keys shared by the workbook mapping, levels.json and the UI. */
export const CATEGORIES = [
  { key: 'total', label: 'All permanent residents' },
  { key: 'economic', label: 'Economic class' },
  { key: 'fhs', label: 'Federal High Skilled (Express Entry)' },
  { key: 'pnp', label: 'Provincial Nominee Program' },
  { key: 'family', label: 'Family class' },
  { key: 'refugees', label: 'Refugees and protected persons' },
  { key: 'humanitarian', label: 'Humanitarian and other' },
];
const KEYS = CATEGORIES.map((c) => c.key);

/** Which workbook row feeds which category, by indentation column and label. */
const ROW_RULES = [
  { key: 'economic', col: 'B', label: 'Economic - Total' },
  { key: 'family', col: 'B', label: 'Sponsored Family - Total' },
  { key: 'refugees', col: 'B', label: 'Resettled Refugee & Protected Person in Canada - Total' },
  { key: 'humanitarian', col: 'B', label: 'All Other Immigration - Total' },
  { key: 'pnp', col: 'C', label: 'Provincial Nominee Program' },
  // Federal High Skilled is the three Express Entry federal programs. Quebec selects
  // its own economic immigrants and its block reuses the same labels ("Skilled
  // Worker" there is the Quebec Skilled Worker program), so Quebec is excluded.
  { key: 'fhs', col: 'D', label: 'Canadian Experience', notIn: 'Quebec' },
  { key: 'fhs', col: 'D', label: 'Skilled Worker', notIn: 'Quebec' },
  { key: 'fhs', col: 'D', label: 'Skilled Trade', notIn: 'Quebec' },
];
/** Rows every province/territory block must carry, or the layout has drifted. */
const REQUIRED_IN_BLOCK = ['Economic - Total', 'Sponsored Family - Total'];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ---------------------------------------------------------------------------
// Minimal zip reader
// ---------------------------------------------------------------------------

function unzipEntry(buf, wanted) {
  check(buf.readUInt32LE(0) === 0x04034b50, 'admissions workbook is not a zip archive');
  // End of central directory: fixed 22 bytes plus an optional comment of <= 64 KB.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  check(eocd >= 0, 'admissions workbook: no zip end-of-central-directory record');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  check(p !== 0xffffffff, 'admissions workbook: zip64 is not supported');

  const names = [];
  for (let n = 0; n < count; n++) {
    check(buf.readUInt32LE(p) === 0x02014b50, 'admissions workbook: corrupt central directory');
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    names.push(name);
    if (wanted(name)) {
      // Sizes come from the central directory: local headers may defer them to a
      // trailing data descriptor.
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const data = buf.subarray(start, start + size);
      if (method === 0) return { name, text: data.toString('utf8') };
      check(method === 8, `admissions workbook: unsupported zip method ${method}`);
      return { name, text: inflateRawSync(data).toString('utf8') };
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return fail(`admissions workbook: no matching entry among ${names.join(', ')}`);
}

// ---------------------------------------------------------------------------
// Sheet parsing
// ---------------------------------------------------------------------------

const decode = (s) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&amp;/g, '&');

/** Rows as `{ n, cells: { A: '...', ... } }`. Handles inline and shared strings. */
function parseSheet(xml, shared) {
  const rows = [];
  for (const [, rowAttrs, body] of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const n = Number(/\br="(\d+)"/.exec(rowAttrs)?.[1]);
    const cells = {};
    for (const [, attrs, inner = ''] of body.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const col = /\br="([A-Z]+)\d+"/.exec(attrs)?.[1];
      if (!col) continue;
      const type = /\bt="([^"]+)"/.exec(attrs)?.[1];
      let value;
      if (type === 'inlineStr') {
        value = [...inner.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join('');
      } else {
        value = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? '';
        if (type === 's') value = shared[Number(value)] ?? '';
      }
      cells[col] = decode(value).trim();
    }
    rows.push({ n, cells });
  }
  return rows;
}

/** "1,290" -> 1290. "--" is IRCC's suppression mark for 1–4 people: counted as 0. */
function count(raw) {
  if (raw === undefined || raw === '') return null;
  if (raw === '--') return 0;
  const n = Number(raw.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

/**
 * Column layout. Row 3 carries the year over its first column only; row 4 the
 * quarter or "YYYY Total"; row 5 the month or "Qn Total". We keep months and the
 * annual total column, and drop quarters.
 */
function mapColumns(yearRow, totalRow, monthRow) {
  // "A" -> 1, "Z" -> 26, "AA" -> 27. Columns A–D hold the row labels.
  const index = (c) => [...c].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
  const cols = [...new Set([...Object.keys(yearRow), ...Object.keys(totalRow), ...Object.keys(monthRow)])]
    .filter((c) => index(c) > 4)
    .sort((a, b) => index(a) - index(b));

  const months = [];
  const annual = new Map();
  let year = null;
  for (const col of cols) {
    if (/^\d{4}$/.test(yearRow[col] ?? '')) year = Number(yearRow[col]);
    const yearTotal = /^(\d{4}) Total$/.exec(totalRow[col] ?? '');
    if (yearTotal) { annual.set(Number(yearTotal[1]), col); continue; }
    const m = MONTHS.indexOf(monthRow[col] ?? '');
    if (m >= 0) {
      check(year !== null, `admissions workbook: month column ${col} precedes any year header`);
      months.push({ col, year, month: m + 1, key: `${year}-${String(m + 1).padStart(2, '0')}` });
    }
  }
  return { months, annual };
}

/** Parse the workbook into national figures per category, monthly and by year. */
export function parseAdmissions(buf) {
  const sheet = unzipEntry(buf, (n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
  let shared = [];
  try {
    const sst = unzipEntry(buf, (n) => n === 'xl/sharedStrings.xml').text;
    shared = [...sst.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
      [...m[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join(''));
  } catch (err) {
    if (!(err instanceof AdmissionsError)) throw err; // inline strings only: fine
  }
  const rows = parseSheet(sheet.text, shared);

  const title = rows.find((r) => r.cells.A)?.cells.A ?? '';
  check(/Admissions of Permanent Residents by Province\/Territory .*Immigration Category/i.test(title),
    `admissions workbook: unexpected title "${title.slice(0, 80)}"`);

  const headerIdx = rows.findIndex((r) => r.cells.A === 'Province/Territory and Immigration Category');
  check(headerIdx >= 0, 'admissions workbook: header row not found');
  const [yearRow, totalRow, monthRow] = [0, 1, 2].map((d) => rows[headerIdx + d]?.cells ?? {});
  const { months, annual } = mapColumns(yearRow, totalRow, monthRow);
  check(months.length >= 12, `admissions workbook: only ${months.length} month columns`);
  check(months[0].key === '2015-01', `admissions workbook: series starts ${months[0].key}, expected 2015-01`);
  for (let i = 1; i < months.length; i++) {
    const [a, b] = [months[i - 1], months[i]];
    const next = a.month === 12 ? `${a.year + 1}-01` : `${a.year}-${String(a.month + 1).padStart(2, '0')}`;
    check(b.key === next, `admissions workbook: month columns jump from ${a.key} to ${b.key}`);
  }

  const zero = () => Object.fromEntries(KEYS.map((k) => [k, 0]));
  const monthly = months.map(zero);
  const yearly = new Map([...annual.keys()].map((y) => [y, zero()]));
  const read = (cells) => ({
    months: months.map((m) => count(cells[m.col])),
    years: new Map([...annual].map(([y, col]) => [y, count(cells[col])])),
  });
  const add = (key, cells) => {
    const v = read(cells);
    v.months.forEach((x, i) => { monthly[i][key] += x ?? 0; });
    for (const [y, x] of v.years) yearly.get(y)[key] += x ?? 0;
  };

  // Each block's rows come *before* the "<Province> - Total" row that names it,
  // so rows are buffered and attributed when that row arrives.
  let block = [];
  const regions = [];
  let canada = null;
  for (const row of rows.slice(headerIdx + 3)) {
    const a = row.cells.A ?? '';
    if (/ - Total$|^Province\/Territory not stated/.test(a)) {
      const region = a.replace(/ - Total$/, '');
      const notStated = /not stated/i.test(region);
      if (!notStated) {
        for (const label of REQUIRED_IN_BLOCK) {
          check(block.some((r) => r.cells.B === label), `admissions workbook: ${region} has no "${label}" row`);
        }
      }
      for (const r of block) {
        for (const rule of ROW_RULES) {
          if (r.cells[rule.col] === rule.label && rule.notIn !== region) add(rule.key, r.cells);
        }
      }
      regions.push(region);
      block = [];
    } else if (a === 'Total') {
      canada = read(row.cells);
      break;
    } else {
      block.push(row);
    }
  }
  check(canada, 'admissions workbook: no national "Total" row');
  check(regions.length >= 13, `admissions workbook: ${regions.length} regions, expected 13 + not stated`);
  check(regions.includes('Quebec'), 'admissions workbook: no Quebec block (needed to exclude it from FHS)');

  canada.months.forEach((x, i) => { monthly[i].total = x; });
  for (const [y, x] of canada.years) yearly.get(y).total = x;

  // The national total is IRCC's own figure; the classes are summed from rounded
  // province cells. They should agree to within rounding — a wide gap means rows
  // were missed or double-counted, i.e. the layout moved.
  const mismatches = [];
  for (const [year, v] of yearly) {
    if (!v.total) continue;
    const classes = v.economic + v.family + v.refugees + v.humanitarian;
    const gap = Math.abs(classes - v.total) / v.total;
    if (gap > 0.005) mismatches.push({ year, total: v.total, sumOfClasses: classes });
    check(gap < 0.03, `admissions workbook: ${year} classes sum to ${classes} against a total of ${v.total}`);
    check(v.fhs <= v.economic && v.pnp <= v.economic, `admissions workbook: ${year} FHS/PNP exceed economic`);
  }

  // The last month column with a national figure is the reporting edge.
  let last = months.length - 1;
  while (last > 0 && !monthly[last].total) last--;
  const sourceLine = rows.map((r) => r.cells.A ?? '').find((a) => /^Source: IRCC,/.test(a)) ?? '';
  const asOf = parseLongDate(sourceLine.replace(/^Source: IRCC,\s*/, ''));

  return {
    asOf,
    through: months[last].key,
    months: months.slice(0, last + 1).map((m) => m.key),
    monthly: Object.fromEntries(KEYS.map((k) => [k, monthly.slice(0, last + 1).map((m) => m[k])])),
    yearly,
    mismatches,
  };
}

function parseLongDate(text) {
  const m = /^([A-Z][a-z]+) (\d{1,2}), (\d{4})/.exec(text.trim());
  if (!m) return null;
  const names = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];
  const month = names.indexOf(m[1]);
  if (month < 0) return null;
  return `${m[3]}-${String(month + 1).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Levels plans
// ---------------------------------------------------------------------------

/** Validate the hand-curated plans; a typo here is a wrong number on the page. */
export function validateLevels(levels) {
  check(Array.isArray(levels?.plans) && levels.plans.length, 'data/levels.json: no plans');
  const seen = new Set();
  for (const plan of levels.plans) {
    const where = `data/levels.json plan ${plan.key}`;
    check(/^\d{4}(-\d{4})?$/.test(plan.key ?? ''), `${where}: bad key`);
    check(!seen.has(plan.key), `${where}: duplicate`);
    seen.add(plan.key);
    check(/^\d{4}-\d{2}-\d{2}$/.test(plan.tabled ?? ''), `${where}: bad tabled date`);
    check(/^https:\/\/www\.canada\.ca\//.test(plan.url ?? ''), `${where}: url must be on canada.ca`);
    const years = Object.keys(plan.years ?? {});
    check(years.length > 0 && years[0] === plan.key.slice(0, 4), `${where}: first year must match the key`);
    for (const [year, values] of Object.entries(plan.years)) {
      for (const key of KEYS) {
        const v = values[key];
        check(v === null || (typeof v === 'object' && v !== undefined), `${where} ${year}: ${key} missing`);
        if (!v) continue;
        for (const f of ['target', 'low', 'high']) {
          check(v[f] === null || (Number.isInteger(v[f]) && v[f] > 0), `${where} ${year} ${key}.${f} is not a count`);
        }
        if (v.low !== null && v.high !== null) check(v.low <= v.high, `${where} ${year} ${key}: low > high`);
        if (v.target !== null && v.low !== null) check(v.low <= v.target, `${where} ${year} ${key}: target below range`);
        if (v.target !== null && v.high !== null) check(v.target <= v.high, `${where} ${year} ${key}: target above range`);
      }
      // Class targets add up to the overall target in every plan since 2016.
      const t = values.total?.target;
      const parts = ['economic', 'family', 'refugees', 'humanitarian'].map((k) => values[k]?.target);
      if (t && parts.every((p) => p)) {
        const sum = parts.reduce((a, b) => a + b, 0);
        check(sum === t, `${where} ${year}: classes sum to ${sum}, overall target is ${t}`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

export function buildAdmissions(parsed, levels) {
  validateLevels(levels);
  const plans = [...levels.plans].sort((a, b) => a.tabled.localeCompare(b.tabled));

  const firstYear = 2015;
  const lastYear = Math.max(
    Number(parsed.through.slice(0, 4)),
    ...plans.flatMap((p) => Object.keys(p.years).map(Number)),
  );
  const [throughYear, throughMonth] = parsed.through.split('-').map(Number);

  const years = [];
  for (let year = firstYear; year <= lastYear; year++) {
    const actual = parsed.yearly.get(year) ?? null;
    const reported = year < throughYear ? 12 : year === throughYear ? throughMonth : 0;

    const versions = plans
      .filter((p) => p.years[String(year)])
      .map((p) => ({ plan: p.key, tabled: p.tabled, values: p.years[String(year)] }));
    // The binding target for a year is the one set by the plan that *starts* with
    // it: tabled just before (or, in election years, early in) that year. Later
    // years in a plan are notional, and get revised — often a lot.
    const binding = versions.find((v) => v.plan.slice(0, 4) === String(year));
    const current = binding ?? versions[versions.length - 1] ?? null;

    // Same months of the previous year, for a like-for-like reading of a partial year.
    let priorSamePeriod = null;
    if (reported > 0 && reported < 12) {
      priorSamePeriod = Object.fromEntries(KEYS.map((k) => {
        let sum = 0;
        for (let m = 1; m <= reported; m++) {
          const i = parsed.months.indexOf(`${year - 1}-${String(m).padStart(2, '0')}`);
          sum += i >= 0 ? parsed.monthly[k][i] : 0;
        }
        return [k, sum];
      }));
    }

    years.push({
      year,
      monthsReported: reported,
      actual: reported > 0 ? actual : null,
      priorSamePeriod,
      target: current ? { plan: current.plan, notional: !binding, values: current.values } : null,
      // Every plan that named a figure for this year, oldest first.
      versions,
    });
  }

  return {
    source: {
      url: ADMISSIONS_URL,
      dataset: ADMISSIONS_DATASET,
      asOf: parsed.asOf,
      through: parsed.through,
    },
    categories: CATEGORIES,
    months: parsed.months,
    monthly: parsed.monthly,
    years,
    plans: plans.map((p) => ({ key: p.key, tabled: p.tabled, url: p.url, notes: p.notes ?? [] })),
    warnings: { classSumMismatches: parsed.mismatches },
  };
}
