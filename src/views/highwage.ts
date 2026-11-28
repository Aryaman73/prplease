import { renderShift } from '../chart/shift';
import { el, field } from '../dom';
import { int, stampDate } from '../format';
import { project, projectNow, TIERS } from '../highwage/model';
import type { Draws, HighWage, Occupation, Round, StockBase, WageTier } from '../types';

/**
 * High Wage — the November 2026 high-wage occupation points: what they are, a NOC
 * lookup, a score check against the projected next CEC cutoff, and an audit of how
 * the first post-change pool moved against what the model expected.
 *
 * The projection comes from the latest post-change pool snapshot: stockflow.py runs
 * each pre-change fit past 3 November with the bonus applied and refits the tier
 * shares to that pool. Once a CEC round has been held under the new rules, its real
 * cutoff is shown beside the projection.
 */

const STORAGE_KEY = 'prplease:high-wage';
const CEC = 'cec';

const TIER_LABEL: Record<WageTier | 'none', string> = {
  '2.0x': '2.0×', '1.5x': '1.5×', '1.3x': '1.3×', none: 'Not listed',
};
/** Occupation median pay against the workforce's average median wage, as the table's row label. */
const TIER_PAY: Record<WageTier, string> = {
  '2.0x': '2× or more',
  '1.5x': '1.5× to 2×',
  '1.3x': '1.3× to 1.5×',
};

/**
 * The score check is for CEC applicants only, and needs nothing but the score and
 * a tier. Without a job offer the new factor is work-length + bonus in place of
 * the work-length points already in today's CRS, so years and spouse status
 * cancel out: new score = CRS today + bonus. Job offers are left out because with
 * a year of Canadian experience an offer in the same tier never beats that.
 */
interface Applicant {
  crs: string;
  tier: WageTier | 'none';
}

const isTier = (v: unknown): v is WageTier => v === '2.0x' || v === '1.5x' || v === '1.3x';

function load(): Applicant {
  const empty: Applicant = { crs: '', tier: 'none' };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return empty;
    const p = JSON.parse(raw) as Partial<Applicant>;
    return { crs: typeof p.crs === 'string' ? p.crs : '', tier: isTier(p.tier) ? p.tier : 'none' };
  } catch {
    return empty;
  }
}

function save(state: Applicant) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* Storage unavailable — works for the session, just doesn't persist. */
  }
}

const TIER_CLASS: Record<WageTier | 'none', string> = { '2.0x': 'high', '1.5x': 'mid', '1.3x': 'low', none: 'none' };
/** Below this share (%) a segment is too narrow at phone width to hold its figure. */
const SHARE_LABEL_MIN = 8;

/** A tier's name and bonus beside its colour: the bar's legend, on the box it describes. */
function tierKey(tier: WageTier | 'none', points: string) {
  return el(
    'span',
    { class: 'hw-tier__key' },
    el('i', { class: `hw-tier__swatch hw-tier-${TIER_CLASS[tier]}`, attrs: { 'aria-hidden': 'true' } }),
    `${TIER_LABEL[tier]} ${points}`,
  );
}

const LOOKUP_LIMIT = 8;

/** "2026-11-03" -> "3 November 2026", for prose (stampDate is the form register). */
function longDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/** Code prefix ("2123"), or every word somewhere in the title ("software eng"). */
function searchOccupations(list: Occupation[], query: string): Occupation[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  if (/^\d+$/.test(q)) return list.filter((o) => o.noc.startsWith(q));
  const words = q.split(/\s+/);
  return list.filter((o) => {
    const title = o.title.toLowerCase();
    return words.every((w) => title.includes(w));
  });
}

function unavailable(): HTMLElement {
  return el(
    'article',
    { class: 'paper' },
    el('div', { class: 'paper__band paper__band--rust' }, el('span', { text: 'Discrepancy' })),
    el(
      'div',
      { class: 'paper__body' },
      el('h2', { class: 'paper__title pixel', text: 'High-wage data unavailable' }),
      el('p', { class: 'paper__note', text: 'The high-wage occupation list could not be loaded. Try again later.' }),
    ),
  );
}

export function renderHighWage(draws: Draws, hw: HighWage | null): HTMLElement {
  if (!hw) return unavailable();

  const effective = Date.parse(`${hw.effective}T00:00:00Z`);
  const cecRounds = draws.rounds.filter(
    (r) => r.category === CEC && r.crsCutoff !== null && r.invitations !== null,
  );
  // Newest first: the pre-change CEC rounds the stock-flow model was fitted through.
  const bases = hw.stockflow.bases;
  // The first CEC round held under the new rules, if there has been one.
  const actual = [...cecRounds].reverse().find((r) => Date.parse(`${r.date}T00:00:00Z`) >= effective) ?? null;

  return el(
    'div',
    {},
    directive(hw),
    // Spread, not wrapped: papers are spaced by `.paper + .paper`, which only
    // matches siblings, so a wrapper element would leave them touching.
    ...(bases.length ? applicantAndProjection(hw, bases, actual) : [el('p', { class: 'empty', text: 'No CEC round to project from.' })]),
    finePrint(hw),
  );
}

/* ── The rule, in plain terms ──────────────────────────────────────────────── */

function directive(hw: HighWage) {
  const counts = { '2.0x': 0, '1.5x': 0, '1.3x': 0 } as Record<WageTier, number>;
  for (const o of hw.occupations) if (o.tier) counts[o.tier]++;
  const listed = counts['2.0x'] + counts['1.5x'] + counts['1.3x'];

  const tierRows = (['2.0x', '1.5x', '1.3x'] as WageTier[]).map((t) =>
    el(
      'tr',
      {},
      el('td', { class: 'strong', text: TIER_PAY[t] }),
      el('td', { class: 'num', text: int(counts[t]) }),
      el('td', { class: 'num strong', text: `+${hw.points.experience[t]}` }),
    ),
  );

  return el(
    'article',
    { class: 'paper' },
    el('div', { class: 'paper__band' }, el('span', { text: 'Directive' })),
    el(
      'div',
      { class: 'paper__body' },
      el('h2', { class: 'paper__title pixel', text: 'High-Wage Occupations' }),
      el(
        'p',
        { class: 'paper__note' },
        `From ${longDate(hw.effective)}, Express Entry adds a bonus for at least 12 months of Canadian work experience in ${listed} occupations IRCC classes as high-wage: those whose median pay across Canada is at least 1.3 times the average median wage of the Canadian workforce. An occupation's tier is the highest it reached in the last three years, and yours is fixed on the day you are invited. The bonus goes on top of the Canadian experience points you already get, and is applied automatically. `,
        el('strong', { text: 'It is the occupation that counts, not your own salary.' }),
      ),
    ),
    el(
      'div',
      { class: 'paper__body paper__body--flush' },
      el(
        'div',
        { class: 'ledger__scroll' },
        el(
          'table',
          { class: 'ledger' },
          el(
            'thead',
            {},
            el(
              'tr',
              {},
              el('th', { text: 'Occupation median pay' }),
              el('th', { class: 'num', text: 'NOCs' }),
              el('th', { class: 'num', text: 'Bonus' }),
            ),
          ),
          el('tbody', {}, ...tierRows),
        ),
      ),
    ),
    el(
      'div',
      { class: 'paper__body' },
      el('h3', { class: 'inspect__label hw-subhead', text: 'Job offers' }),
      el(
        'p',
        { class: 'hw-copy' },
        `A job offer in a listed occupation (${hw.points.offer['2.0x']} / ${hw.points.offer['1.5x']} / ${hw.points.offer['1.3x']}, no LMIA needed) replaces your Canadian experience points (length points plus bonus) instead of adding to them, and you get whichever is higher. It only raises your score if it is in a higher tier than your 12 months of experience, or if you have under 12 months in listed jobs. For most CEC candidates it changes nothing, so this page leaves job offers out.`,
      ),
    ),
  );
}

/* ── Score check + projection (they share one projected cutoff) ───────────── */

/** "November 22, 2026" (IRCC's form) -> "22 November 2026". */
function poolDate(asOf: string): string {
  const d = new Date(`${asOf} UTC`);
  return Number.isNaN(d.getTime()) ? asOf : longDate(d.toISOString().slice(0, 10));
}

function applicantAndProjection(hw: HighWage, bases: StockBase[], actual: Round | null): HTMLElement[] {
  const applicant = load();
  const recal = hw.stockflow.recalibration;
  const last = bases[0]!;
  const defaultPreset = hw.presets.find((p) => p.key === recal.defaultPreset) ?? hw.presets[0]!;
  const central = recal.variants.find((v) => v.key === 'central') ?? recal.variants[0]!;
  const fitted = central.mixes[defaultPreset.key]!;
  const shares = fitted.shares;
  const assumedListed = 1 - defaultPreset.shares.none;
  const snapshot = poolDate(recal.poolAsOf);

  // What this page projected before the pool moved: the last pre-change round, rescored
  // with the default shares. Kept so the refit can be read against it.
  const before = project(hw, { base: last, shares: defaultPreset.shares });
  const lastStock = before.today;

  let size: number | null = null;
  let disposeChart: (() => void) | null = null;

  /* Applicant input: since the change, the profile's score already has the bonus in it. */
  const crsInput = el('input', {
    class: 'inspect__input pixel',
    attrs: { id: 'hw-crs', type: 'number', min: '0', max: '1200', inputmode: 'numeric', placeholder: '000', autocomplete: 'off' },
  });
  crsInput.value = applicant.crs;
  const applicantFields = el('div', { class: 'fields hw-fields' });
  const applicantTally = el('p', { class: 'inspect__tally' });

  /* Projection outputs */
  const figureAfter = el('span', { class: 'figure__value' });
  const figureDelta = el('span', { class: 'figure__label' });
  const figureRange = el('p', { class: 'hw-range' });
  const baseNote = el('p', { class: 'paper__note' });
  const actualLine = el('div', { class: 'fields hw-actual' });
  const chartHost = el('div', { class: 'chart__host' });
  const tierBody = el('tbody', {});
  const sizeInput = el('input', { class: 'hw-input', attrs: { id: 'hw-size', type: 'number', min: '100', step: '100' } });

  const shareBar = el('div', {
    class: 'hw-share',
    attrs: {
      role: 'img',
      'aria-label': `Fitted share of CEC candidates by tier: ${TIERS.map((t) => `${TIER_LABEL[t]} ${(shares[t] * 100).toFixed(1)}%`).join(', ')}.`,
    },
  });
  for (const t of TIERS) {
    const pct = shares[t] * 100;
    if (pct <= 0) continue;
    const seg = el('div', { class: `hw-share__seg hw-tier-${TIER_CLASS[t]}` }, el('span', { text: pct >= SHARE_LABEL_MIN ? `${Math.round(pct)}%` : '' }));
    seg.style.flexGrow = String(shares[t]);
    seg.title = `${TIER_LABEL[t]}: ${pct.toFixed(1)}%`;
    shareBar.append(seg);
  }
  const shareKeys = el(
    'div',
    { class: 'hw-tiers' },
    ...TIERS.map((t) =>
      el('div', { class: 'hw-tier' }, tierKey(t, t === 'none' ? '+0' : `+${hw.points.experience[t]}`), el('output', { class: 'hw-input hw-none', text: `${(shares[t] * 100).toFixed(1)}%` })),
    ),
  );

  const update = () => {
    const n = size ?? last.invitations;
    const result = projectNow(hw, n);
    if (size === null) sizeInput.value = String(last.invitations);

    figureAfter.textContent = String(result.after);
    const delta = result.after - last.crsCutoff;
    figureDelta.textContent = `${delta >= 0 ? '+' : ''}${delta} points`;
    figureRange.textContent = result.low === result.high ? '' : `Likely ${result.low}–${result.high}`;
    baseNote.textContent = `From the pool on ${snapshot}, for a CEC draw of ${int(n)}. No CEC draw had been held since No. ${last.number}, so the pool had about five extra weeks of new profiles as well as the bonus.`;

    actualLine.replaceChildren();
    if (actual) {
      actualLine.append(
        field(`Actual · No. ${actual.number} · ${stampDate(actual.date)}`, `${int(actual.crsCutoff)} (${int(actual.invitations)} invited)`),
      );
    }

    disposeChart?.();
    disposeChart = renderShift(chartHost, {
      today: lastStock, shifted: result.now, before: last.crsCutoff, after: result.after,
      labels: { today: stampDate(last.date), shifted: stampDate(recal.asOf) },
    });

    const invited = TIERS.map((t) => result.invitedByTier[t]);
    const total = invited.reduce((a, b) => a + b, 0) || 1;
    tierBody.replaceChildren(
      ...TIERS.map((t, i) =>
        el(
          'tr',
          {},
          el('td', { text: TIER_LABEL[t] }),
          el('td', { class: 'num', text: int(Math.round(invited[i]!)) }),
          el('td', { class: 'num strong', text: `${Math.round((invited[i]! / total) * 100)}%` }),
        ),
      ),
    );

    renderApplicant(result.after, result.low, result.high);
  };

  const renderApplicant = (projected: number, low: number, high: number) => {
    save({ crs: crsInput.value, tier: 'none' });
    applicantFields.replaceChildren();
    applicantTally.textContent = '';
    const score = Number(crsInput.value);
    if (!crsInput.value.trim() || !Number.isFinite(score) || score < 0 || score > 1200) {
      applicantFields.append(el('p', { class: 'empty', text: 'Enter the CRS score on your profile to compare it with the projected cutoff.' }));
      return;
    }
    const margin = score - projected;
    applicantFields.append(field('Your score', int(score)), field('Projected CEC cutoff', int(projected)));
    const verdict =
      margin >= 0
        ? `${int(score)} clears the projected cutoff by ${margin}.`
        : `${int(score)} is ${-margin} short of the projected cutoff.`;
    const where = score >= high || score < low ? '' : ` That is inside the likely range of ${low}–${high}, so it could go either way.`;
    applicantTally.textContent = verdict + where;
  };

  crsInput.addEventListener('input', () => update());
  sizeInput.addEventListener('input', () => {
    const v = Number(sizeInput.value);
    size = Number.isFinite(v) && v > 0 ? v : null;
    update();
  });

  const control = (label: string, forId: string, input: HTMLElement) =>
    el('div', { class: 'hw-control' }, el('label', { class: 'inspect__label', text: label, attrs: { for: forId } }), input);

  const applicantPaper = el(
    'article',
    { class: 'paper' },
    el('div', { class: 'paper__band paper__band--olive' }, el('span', { text: 'Applicant Verification' })),
    el(
      'div',
      { class: 'paper__body' },
      el('h2', { class: 'paper__title pixel', text: 'Score Check' }),
      el('p', {
        class: 'paper__note',
        text: `For people in Canada applying through CEC. Since ${longDate(hw.effective)} IRCC has rescored every profile, so the score on yours already includes any high-wage bonus. Enter it as shown.`,
      }),
      el(
        'form',
        { class: 'inspect', on: { submit: (e) => { e.preventDefault(); update(); } } },
        el('div', { class: 'inspect__group' }, el('label', { class: 'inspect__label', text: 'CRS on your profile', attrs: { for: 'hw-crs' } }), crsInput),
      ),
      el('div', { class: 'hw-result' }, applicantFields),
      applicantTally,
    ),
  );

  const projectionPaper = el(
    'article',
    { class: 'paper' },
    el('div', { class: 'paper__band' }, el('span', { text: 'Projection' })),
    el(
      'div',
      { class: 'paper__body' },
      el('h2', { class: 'paper__title pixel', text: 'Next CEC Cut-off' }),
      el(
        'div',
        { class: 'figure hw-figure' },
        el('span', { class: 'figure__label', text: `No. ${last.number}` }),
        el('span', { class: 'figure__value', text: String(last.crsCutoff) }),
        el('span', { class: 'figure__label', text: '→' }),
        figureAfter,
        figureDelta,
      ),
      figureRange,
      actualLine,
      baseNote,
      el(
        'div',
        { class: 'hw-legend' },
        el('span', {}, el('i', { class: 'shift-key shift-key--today' }), `Before the last pre-change draw (${stampDate(last.date)})`),
        el('span', {}, el('i', { class: 'shift-key shift-key--after' }), `Pool on ${stampDate(recal.asOf)}, with the bonus`),
      ),
      chartHost,
      el('p', { class: 'hw-hint', text: 'CEC candidates per 5-point bin, as the stock-flow model estimates them. IRCC only publishes 501–600 as one band, so the shape inside it is the model’s.' }),
      el(
        'section',
        { class: 'hw-assumptions' },
        el('h3', { class: 'inspect__label', text: 'Assumptions' }),
        el('div', { class: 'hw-grid' }, control('Draw size', 'hw-size', sizeInput)),
        el(
          'div',
          { class: 'hw-control hw-share-block' },
          el('span', { class: 'inspect__label', text: `Who is in which tier, fitted to the ${stampDate(recal.asOf)} pool` }),
          shareBar,
          shareKeys,
          el('p', {
            class: 'hw-hint',
            text: `${defaultPreset.label}, scaled until the model reproduces the pool's 501–600 band: ${Math.round(fitted.listed * 100)}% of CEC candidates in listed tiers, up from the ${Math.round(assumedListed * 100)}% assumed before.`,
          }),
        ),
      ),
    ),
    el('div', { class: 'paper__body hw-caption' }, el('h3', { class: 'inspect__label hw-subhead', text: 'Invited at the projected cutoff' })),
    el(
      'div',
      { class: 'paper__body paper__body--flush' },
      el(
        'div',
        { class: 'ledger__scroll' },
        el(
          'table',
          { class: 'ledger' },
          el('thead', {}, el('tr', {}, el('th', { text: 'Tier' }), el('th', { class: 'num', text: 'Candidates' }), el('th', { class: 'num', text: 'Share' }))),
          tierBody,
        ),
      ),
    ),
  );

  update();
  return [occupationLookup(hw), applicantPaper, projectionPaper, poolCheck(hw, before.after, last)];
}

/* ── How the pool moved against the prediction ─────────────────────────────── */

const CHECK_BANDS = ['461-470', '471-480', '481-490', '491-500', '501-600'];

function poolCheck(hw: HighWage, projectedBefore: number, last: StockBase): HTMLElement {
  const recal = hw.stockflow.recalibration;
  const central = recal.variants.find((v) => v.key === 'central') ?? recal.variants[0]!;
  const defaultPreset = hw.presets.find((p) => p.key === recal.defaultPreset) ?? hw.presets[0]!;
  const fitted = central.mixes[defaultPreset.key]!;
  const cell = (v: number | null | undefined, cls = 'num') => el('td', { class: cls, text: v == null ? '—' : int(v) });
  const headline = projectNow(hw, last.invitations).after;

  const rows = CHECK_BANDS.map((b) =>
    el(
      'tr',
      {},
      el('td', { class: 'strong', text: b }),
      cell(recal.previous[b]),
      cell(central.asAssumed[b]),
      cell(central.predicted?.[b]),
      cell(recal.observed[b], 'num strong'),
    ),
  );

  const verdicts = recal.variants.map((v) => {
    const kept = Object.values(v.mixes).filter((m) => !m.ruledOut);
    const meta = v.ruledOut && !kept.length
      ? `Ruled out: ${v.ruledOut}`
      : `Kept: ${Math.round(Math.min(...kept.map((m) => m.listed)) * 100)}–${Math.round(Math.max(...kept.map((m) => m.listed)) * 100)}% listed`;
    return el(
      'li',
      { class: 'verdict' },
      el('span', { class: 'verdict__name', text: v.label }),
      el('span', { class: `verdict__meta${kept.length ? ' hw-listed' : ''}`, text: meta }),
    );
  });

  const prev = recal.previous['501-600'] ?? 0;
  const seen = recal.observed['501-600'] ?? 0;
  const expected = central.asAssumed['501-600'] ?? 0;
  // How far the refitted model sits above the pool in the bands it isn't fitted to.
  const misses = CHECK_BANDS.filter((b) => b !== '501-600').map((b) => {
    const o = recal.observed[b];
    const p = central.predicted?.[b];
    return o && p ? Math.round(((p - o) / o) * 100) : 0;
  });
  const missLo = Math.min(...misses);
  const missHi = Math.max(...misses);

  return el(
    'article',
    { class: 'paper' },
    el('div', { class: 'paper__band paper__band--rust' }, el('span', { text: 'Audit' })),
    el(
      'div',
      { class: 'paper__body' },
      el('h2', { class: 'paper__title pixel', text: 'Did the Pool Move as Expected?' }),
      el(
        'p',
        { class: 'paper__note' },
        `The ${poolDate(recal.poolAsOf)} pool is the first since the change. With the shares this page assumed, the model expected 501–600 to grow from ${int(prev)} to about ${int(expected)}. It grew to ${int(seen)}: more CEC candidates are in listed occupations than IRCC's invitee data suggested. Matching it takes ${Math.round(fitted.listed * 100)}% of them in listed tiers, not ${Math.round((1 - defaultPreset.shares.none) * 100)}%. `,
        el('strong', { text: `That moves the projected cutoff for ${int(last.invitations)} invitations from ${projectedBefore} to ${headline}.` }),
      ),
    ),
    el(
      'div',
      { class: 'paper__body paper__body--flush' },
      el(
        'div',
        { class: 'ledger__scroll' },
        el(
          'table',
          { class: 'ledger' },
          el(
            'thead',
            {},
            el(
              'tr',
              {},
              el('th', { text: 'CRS band' }),
              el('th', { class: 'num', text: stampDate(new Date(`${recal.previousPoolAsOf} UTC`).toISOString().slice(0, 10)) }),
              el('th', { class: 'num', text: 'Expected' }),
              el('th', { class: 'num', text: 'Refitted' }),
              el('th', { class: 'num', text: stampDate(recal.asOf) }),
            ),
          ),
          el('tbody', {}, ...rows),
        ),
      ),
    ),
    el(
      'div',
      { class: 'paper__body' },
      el('p', {
        class: 'hw-hint',
        text: `Whole pool, CEC and not. Only 501–600 is fitted. Below 500 the refitted model runs ${missLo}–${missHi}% high, largely because category draws such as the French-language draw on 27 October (5,000 invited from 407 up) take far more from those bands than the model’s average attrition allows.`,
      }),
      el('h3', { class: 'inspect__label hw-subhead hw-subhead--gap', text: 'Which fits survived' }),
      el('ul', { class: 'verdicts' }, ...verdicts),
      el('p', {
        class: 'hw-hint',
        text: `Each fit is refitted with every tier mix in the presets. One is ruled out if it can't reproduce the 501–600 band, needs over ${Math.round(recal.maxListed * 100)}% of CEC candidates in listed tiers (no source comes close), or misses 461–500 by more than half. The likely range spans the rest.`,
      }),
    ),
  );
}

/* ── NOC lookup ────────────────────────────────────────────────────────────── */

function occupationLookup(hw: HighWage) {
  const input = el('input', {
    class: 'hw-input hw-input--wide',
    attrs: { id: 'hw-lookup', type: 'search', placeholder: 'e.g. 21231, or software engineer', autocomplete: 'off', spellcheck: 'false' },
  });
  const results = el('ul', { class: 'verdicts hw-lookup', attrs: { 'aria-live': 'polite' } });
  const status = el('p', { class: 'hw-hint' });

  const render = () => {
    const matches = searchOccupations(hw.occupations, input.value);
    results.replaceChildren();
    status.textContent = '';
    if (!input.value.trim()) return;
    if (matches.length === 0) {
      results.append(el('li', { class: 'empty', text: 'No NOC 2021 occupation matches that.' }));
      return;
    }
    for (const o of matches.slice(0, LOOKUP_LIMIT)) {
      const label = o.tier ? `${TIER_LABEL[o.tier]} · +${hw.points.experience[o.tier]}` : 'Not listed';
      results.append(
        el(
          'li',
          { class: 'verdict' },
          el('span', { class: 'verdict__name', text: `${o.noc} · ${o.title}` }),
          el('span', { class: `verdict__meta${o.tier ? ' hw-listed' : ''}`, text: label }),
        ),
      );
    }
    if (matches.length > LOOKUP_LIMIT) {
      status.textContent = `${matches.length - LOOKUP_LIMIT} more match. Keep typing to narrow it down.`;
    }
  };
  input.addEventListener('input', render);

  return el(
    'article',
    { class: 'paper' },
    el('div', { class: 'paper__band' }, el('span', { text: 'Occupation Lookup' })),
    el(
      'div',
      { class: 'paper__body' },
      el('p', {
        class: 'paper__note',
        text: 'Search by NOC code or job title. IRCC goes by the NOC that matches your duties, not your job title, so check the code on your profile.',
      }),
      el(
        'div',
        { class: 'hw-control hw-lookup__field' },
        el('label', { class: 'inspect__label', text: 'NOC code or job title', attrs: { for: 'hw-lookup' } }),
        input,
      ),
      results,
      status,
    ),
  );
}

/* ── Method and sources ────────────────────────────────────────────────────── */

function finePrint(hw: HighWage) {
  const link = (text: string, href: string) => el('a', { text, attrs: { href, rel: 'noopener' } });
  return el(
    'article',
    { class: 'paper' },
    el('div', { class: 'paper__band paper__band--rust' }, el('span', { text: 'Fine print' })),
    el(
      'div',
      { class: 'paper__body' },
      el(
        'ul',
        { class: 'hw-rules hw-rules--fine' },
        el('li', {}, el('strong', { text: 'This is an estimate, not advice.' }), ' Check your own points with IRCC before acting on it.'),
        el('li', {}, 'IRCC publishes the pool in bands and says nothing about how many of each band are CEC candidates, the only ones a CEC draw can invite. So the CEC pool is modelled instead: new CEC profiles arrive every day, each CEC draw takes everyone above its cutoff, profiles expire after 12 months, and a weekly attrition rate covers everything else (category draws, PNP nominations). Fitted to every CEC draw and pool snapshot from June 2025 to the change, it reproduces their cutoffs to within about 1.5 points.'),
        el('li', {}, 'Each fit is then run past 3 November: everyone in a listed tier moves up by its bonus, and new profiles arrive already moved. The share in listed tiers is the unknown, so it is scaled until the model matches the 501–600 band in every pool snapshot since the change (and any CEC draw under the new rules). The fit is rerun as new snapshots arrive.'),
        el('li', {}, 'The likely range spans the fits that survive that check, each with every preset’s mix between the three tiers.'),
        el('li', {}, 'All of the jump in 501–600 is put down to the CEC bonus. Some of it may be candidates outside CEC who gained new job-offer points; if so, fewer CEC candidates are above 500 than modelled and the cutoff would come in lower.'),
        el('li', {}, 'Tiers are assumed independent of score. The projection is for the pool as of its snapshot: profiles that arrive before the draw push the cutoff up (roughly 1–2 points a week), and category draws in between can pull it down.'),
        el('li', {}, '“Who is in which tier” sources. “CEC invitees”, the default, is IRCC’s open data on CEC invitees by occupation for 2026 so far, with NOC 2011 codes mapped to NOC 2021. “Top invited occupations” is the 15 most common occupations of all invited candidates in IRCC’s Express Entry Year-End Report 2024, about a third of invitations, assuming the rest look the same. The 2021 Census options use employment in TEER 0–3 occupations (Statistics Canada tables 98-10-0449, 98-10-0316, 98-10-0585). “CEC immigrants” describes people who landed in 2016–21 and puts noticeably more of them in listed occupations than recent CEC invitees. Temporary-resident shares are estimated from 4-digit occupation groups.'),
      ),
      el(
        'p',
        { class: 'paper__note' },
        'Sources: ',
        link('IRCC high-wage occupations list', hw.listUrl),
        ' · ',
        link('IRCC: how the new points combine', hw.changesUrl),
        ' · ',
        link('IRCC job offer requirements', 'https://www.canada.ca/en/immigration-refugees-citizenship/services/immigrate-canada/express-entry/documents/job-offer.html'),
        ' · ',
        link('IRCC backgrounder', 'https://www.canada.ca/en/immigration-refugees-citizenship/news/2026/10/changes-to-express-entry-for-high-wage-occupations.html'),
        '. Method and data: research/high-wage in this site’s repository.',
      ),
    ),
  );
}
