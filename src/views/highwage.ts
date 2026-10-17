import { renderShift } from '../chart/shift';
import { el, field } from '../dom';
import { int, stampDate } from '../format';
import { applicantScore, project, sharesFromPercents, TIERS } from '../highwage/model';
import type { Draws, HighWage, Occupation, Round, WageTier } from '../types';

/**
 * High Wage — the November 2026 high-wage occupation points: what they are, what
 * they do to one applicant's score, and a projection of the next CEC cutoff.
 *
 * The projection is only meaningful from pool snapshots taken *before* the rule
 * takes effect; later snapshots already include the bonus and would count it
 * twice. Once a CEC round has been held under the new rules, its real cutoff is
 * shown beside the projection rather than replacing it, so the estimate can be
 * checked against what happened.
 */

const STORAGE_KEY = 'prplease:high-wage';
const CEC = 'cec';

const TIER_LABEL: Record<WageTier | 'none', string> = {
  '2.0x': '2.0×', '1.5x': '1.5×', '1.3x': '1.3×', none: 'Not listed',
};
/** Silkscreen has no × glyph, so anything set in pixel type spells it as X. */
const TIER_STAMP: Record<WageTier, string> = { '2.0x': '2.0X', '1.5x': '1.5X', '1.3x': '1.3X' };
/** Occupation median pay against the national median, as the table's row label. */
const TIER_PAY: Record<WageTier, string> = {
  '2.0x': '2× or more',
  '1.5x': '1.5× to 2×',
  '1.3x': '1.3× to 1.5×',
};

const YEAR_OPTIONS = ['Less than 1 year', '1 year', '2 years', '3 years', '4 years', '5 years or more'];
const OFFER_OPTIONS: { value: WageTier | 'none'; label: string }[] = [
  { value: 'none', label: 'No job offer' },
  { value: '2.0x', label: 'In a 2.0× occupation' },
  { value: '1.5x', label: 'In a 1.5× occupation' },
  { value: '1.3x', label: 'In a 1.3× occupation' },
];

interface Applicant {
  crs: string;
  occupation: string;
  years: number;
  hasSpouse: boolean;
  /** 12+ months of that Canadian experience was in the occupation above. */
  hasYear: boolean;
  offer: WageTier | 'none';
}

const isTier = (v: unknown): v is WageTier => v === '2.0x' || v === '1.5x' || v === '1.3x';

function load(): Applicant {
  const empty: Applicant = { crs: '', occupation: '', years: 1, hasSpouse: false, hasYear: true, offer: 'none' };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return empty;
    const p = JSON.parse(raw) as Partial<Applicant>;
    return {
      crs: typeof p.crs === 'string' ? p.crs : '',
      occupation: typeof p.occupation === 'string' ? p.occupation : '',
      years: typeof p.years === 'number' && p.years >= 0 && p.years <= 5 ? p.years : empty.years,
      hasSpouse: typeof p.hasSpouse === 'boolean' ? p.hasSpouse : false,
      hasYear: typeof p.hasYear === 'boolean' ? p.hasYear : true,
      offer: isTier(p.offer) ? p.offer : 'none',
    };
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

function measuredAt(round: Round): number {
  const t = round.poolAsOf ? Date.parse(round.poolAsOf) : Number.NaN;
  return Number.isNaN(t) ? Date.parse(round.date) : t;
}

/** "21231", "21231 Software engineers…", or an exact title. */
function findOccupation(list: Occupation[], query: string): Occupation | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  const code = q.match(/^\d{5}/)?.[0];
  if (code) return list.find((o) => o.noc === code) ?? null;
  return list.find((o) => o.title.toLowerCase() === q) ?? null;
}

function stamp(text: string, kind: 'approved' | 'denied' | 'flag') {
  return el('span', { class: `stamp stamp--${kind} stamp--land`, text });
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
  // Newest first. Only snapshots measured before the change can be projected from.
  const bases = cecRounds.filter((r) => measuredAt(r) < effective).slice(0, 12);
  // The first CEC round held under the new rules, if there has been one.
  const actual = [...cecRounds].reverse().find((r) => Date.parse(`${r.date}T00:00:00Z`) >= effective) ?? null;

  return el(
    'div',
    {},
    directive(hw),
    bases.length ? applicantAndProjection(hw, bases, actual) : el('p', { class: 'empty', text: 'No CEC pool snapshot to project from.' }),
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
      el('td', { class: 'num', text: String(hw.points.offer[t]) }),
    ),
  );

  return el(
    'article',
    { class: 'paper' },
    el(
      'div',
      { class: 'paper__band' },
      el('span', { text: 'Directive' }),
      el('span', { text: `Effective ${stampDate(hw.effective)}` }),
    ),
    el(
      'div',
      { class: 'paper__body' },
      el('h2', { class: 'paper__title pixel', text: 'High-Wage Occupations' }),
      el('p', {
        class: 'paper__note',
        text: `Express Entry adds points for work in ${listed} occupations IRCC classes as high-wage: those where the median pay across Canada is at least 1.3 times the national median. It is the occupation that counts, not your own salary.`,
      }),
      el(
        'ul',
        { class: 'hw-rules' },
        el(
          'li',
          {},
          el('strong', { text: 'Canadian experience: ' }),
          'the length points you already get (up to 80, or 70 with a spouse), plus +20, +40 or +70 if at least 12 months were in listed occupations. Applied automatically.',
        ),
        el(
          'li',
          {},
          el('strong', { text: 'Or a job offer ' }),
          'in a listed occupation: 50, 70 or 100. It replaces your experience points rather than adding to them, and you get whichever is higher. No LMIA needed.',
        ),
        el(
          'li',
          {},
          'So with a year or more of Canadian experience in a listed occupation, a job offer in the same tier never raises your score. Offers matter for people with under a year of Canadian experience, or whose experience is outside the list.',
        ),
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
              el('th', { text: 'Median pay' }),
              el('th', { class: 'num', text: 'NOCs' }),
              el('th', { class: 'num', text: 'Bonus' }),
              el('th', { class: 'num', text: 'Or offer' }),
            ),
          ),
          el('tbody', {}, ...tierRows),
        ),
      ),
    ),
  );
}

/* ── Score check + projection (they share one projected cutoff) ───────────── */

function applicantAndProjection(hw: HighWage, bases: Round[], actual: Round | null) {
  const applicant = load();
  const defaultPreset = hw.presets.find((p) => p.key === hw.defaultPreset) ?? hw.presets[0]!;

  const proj = {
    baseIndex: 0,
    presetKey: defaultPreset.key as string,
    percents: [defaultPreset.shares['2.0x'], defaultPreset.shares['1.5x'], defaultPreset.shares['1.3x']].map((v) =>
      Math.round(v * 1000) / 10,
    ) as [number, number, number],
    size: null as number | null,
    reach: null as number | null,
  };

  let disposeChart: (() => void) | null = null;

  /* Applicant inputs */
  const crsInput = el('input', {
    class: 'inspect__input pixel',
    attrs: { id: 'hw-crs', type: 'number', min: '0', max: '1200', inputmode: 'numeric', placeholder: '000', autocomplete: 'off' },
  });
  crsInput.value = applicant.crs;

  const listId = 'hw-occupations';
  const occInput = el('input', {
    class: 'hw-input hw-input--wide',
    attrs: { id: 'hw-occ', type: 'text', list: listId, placeholder: 'NOC code or job title', autocomplete: 'off', spellcheck: 'false' },
  });
  occInput.value = applicant.occupation;
  const datalist = el(
    'datalist',
    { attrs: { id: listId } },
    ...hw.occupations.map((o) => el('option', { attrs: { value: `${o.noc} ${o.title}` } })),
  );

  const yearsSelect = el(
    'select',
    { class: 'hw-input', attrs: { id: 'hw-years' } },
    ...YEAR_OPTIONS.map((label, i) => el('option', { text: label, attrs: { value: String(i) } })),
  );
  yearsSelect.value = String(applicant.years);
  const offerSelect = el(
    'select',
    { class: 'hw-input', attrs: { id: 'hw-offer' } },
    ...OFFER_OPTIONS.map((o) => el('option', { text: o.label, attrs: { value: o.value } })),
  );
  offerSelect.value = applicant.offer;
  const yearBox = el('input', { attrs: { type: 'checkbox', id: 'hw-year' } });
  yearBox.checked = applicant.hasYear;
  const spouseBox = el('input', { attrs: { type: 'checkbox', id: 'hw-spouse' } });
  spouseBox.checked = applicant.hasSpouse;

  const occStamp = el('div', { class: 'hw-occ-stamp', attrs: { 'aria-live': 'polite' } });
  const applicantFields = el('div', { class: 'fields hw-fields' });
  const applicantTally = el('p', { class: 'inspect__tally' });
  const applicantVerdict = el('div', { class: 'hw-verdict', attrs: { 'aria-live': 'polite' } });

  /* Projection outputs */
  const figureBefore = el('span', { class: 'figure__value' });
  const figureAfter = el('span', { class: 'figure__value' });
  const figureDelta = el('span', { class: 'figure__label' });
  const baseNote = el('p', { class: 'paper__note' });
  const actualLine = el('div', { class: 'fields hw-actual' });
  const chartHost = el('div', { class: 'chart__host' });
  const tierBody = el('tbody', {});

  /* Assumption controls */
  const baseSelect = el(
    'select',
    { class: 'hw-input', attrs: { id: 'hw-base' } },
    ...bases.map((r, i) =>
      el('option', {
        text: `No. ${r.number} · ${stampDate(r.date)} · ${int(r.invitations)} @ ${int(r.crsCutoff)}`,
        attrs: { value: String(i) },
      }),
    ),
  );
  const sizeInput = el('input', { class: 'hw-input', attrs: { id: 'hw-size', type: 'number', min: '100', step: '100' } });
  const presetSelect = el(
    'select',
    { class: 'hw-input hw-input--wide', attrs: { id: 'hw-preset' } },
    ...hw.presets.map((p) => el('option', { text: p.label, attrs: { value: p.key } })),
    el('option', { text: 'Custom', attrs: { value: 'custom' } }),
  );
  presetSelect.value = proj.presetKey;
  const presetNote = el('p', { class: 'hw-hint' });
  const tierInputs = (['2.0x', '1.5x', '1.3x'] as WageTier[]).map((t) =>
    el('input', { class: 'hw-input hw-input--num', attrs: { id: `hw-t-${t}`, type: 'number', min: '0', max: '100', step: '0.5' } }),
  );
  const noneOut = el('output', { class: 'hw-none', attrs: { for: tierInputs.map((i) => i.id).join(' ') } });
  const reachInput = el('input', { class: 'hw-input hw-input--num', attrs: { id: 'hw-reach', type: 'number', min: '1', max: '100', step: '1' } });
  const reachNote = el('p', { class: 'hw-hint' });

  const syncTierInputs = () => {
    tierInputs.forEach((input, i) => { input.value = String(proj.percents[i]); });
  };

  const applyPreset = (key: string) => {
    const preset = hw.presets.find((p) => p.key === key);
    proj.presetKey = key;
    if (preset) {
      proj.percents = [preset.shares['2.0x'], preset.shares['1.5x'], preset.shares['1.3x']].map((v) =>
        Math.round(v * 1000) / 10,
      ) as [number, number, number];
      syncTierInputs();
    }
  };

  const update = () => {
    const base = bases[proj.baseIndex]!;
    const shares = sharesFromPercents(...proj.percents);
    const result = project(hw, {
      round: base,
      shares,
      size: proj.size ?? undefined,
      reach: proj.reach ?? undefined,
    });

    // Assumption read-outs
    const preset = hw.presets.find((p) => p.key === proj.presetKey);
    presetNote.textContent = preset ? preset.note : 'Your own tier shares.';
    noneOut.textContent = `${(shares.none * 100).toFixed(1)}%`;
    if (proj.size === null) sizeInput.value = String(base.invitations ?? '');

    if (!result) {
      figureBefore.textContent = '—';
      figureAfter.textContent = '—';
      figureDelta.textContent = '';
      baseNote.textContent = `Round No. ${base.number} has an incomplete pool snapshot.`;
      return;
    }

    if (proj.reach === null) reachInput.value = String(Math.round(result.calibratedReach * 100));
    reachNote.textContent = `Calibrated: ${Math.round(result.calibratedReach * 100)}%, the share at which this snapshot reproduces the actual cutoff of ${int(base.crsCutoff)}.`;

    figureBefore.textContent = String(result.before);
    figureAfter.textContent = String(result.after);
    const delta = result.after - result.before;
    figureDelta.textContent = `${delta >= 0 ? '+' : ''}${delta} points`;
    baseNote.textContent = `From round No. ${base.number} (${stampDate(base.date)}): ${int(result.size)} invitations, pool measured ${stampDate(new Date(measuredAt(base)).toISOString())}. Assumes ${Math.round(shares.none * 100)}% of candidates' experience is outside the list.`;

    actualLine.replaceChildren();
    if (actual) {
      actualLine.append(
        field(`Actual · No. ${actual.number} · ${stampDate(actual.date)}`, `${int(actual.crsCutoff)} (${int(actual.invitations)} invited)`),
      );
    }

    disposeChart?.();
    disposeChart = renderShift(chartHost, {
      today: result.today, shifted: result.shifted, reach: result.reach, before: result.before, after: result.after,
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

    renderApplicant(result.after);
  };

  const renderApplicant = (projected: number) => {
    const state: Applicant = {
      crs: crsInput.value,
      occupation: occInput.value,
      years: Number(yearsSelect.value),
      hasSpouse: spouseBox.checked,
      hasYear: yearBox.checked,
      offer: isTier(offerSelect.value) ? offerSelect.value : 'none',
    };
    save(state);

    const occ = findOccupation(hw.occupations, occInput.value);
    occStamp.replaceChildren();
    if (occ) {
      occStamp.append(
        occ.tier ? stamp(`LISTED ${TIER_STAMP[occ.tier]}`, 'approved') : stamp('NOT LISTED', 'denied'),
        el('span', { class: 'hw-occ-name', text: `${occ.noc} · ${occ.title}` }),
      );
    } else if (occInput.value.trim()) {
      occStamp.append(el('span', { class: 'hw-hint', text: 'Pick an occupation from the list, or type its 5-digit NOC code.' }));
    }

    applicantFields.replaceChildren();
    applicantVerdict.replaceChildren();
    applicantTally.textContent = '';
    const crs = Number(crsInput.value);
    if (!crsInput.value.trim() || !Number.isFinite(crs) || crs < 0 || crs > 1200) {
      applicantFields.append(el('p', { class: 'empty', text: 'Enter your current CRS score and occupation to see your new score.' }));
      return;
    }

    // Twelve months in an occupation can't exceed the total; the box means nothing under a year.
    yearBox.disabled = state.years < 1;
    const experienceTier = occ?.tier && state.hasYear ? occ.tier : null;
    const offerTier = state.offer === 'none' ? null : state.offer;
    const r = applicantScore(hw, { crs, years: state.years, hasSpouse: state.hasSpouse, experienceTier, offerTier });
    const margin = r.score - projected;
    const bonus = r.experienceOption - r.workLength;

    applicantFields.append(
      field('Score today', int(crs)),
      field('Work-length points (in that score)', int(r.workLength)),
      field('Experience option', bonus ? `${r.workLength} + ${bonus} = ${r.experienceOption}` : int(r.experienceOption)),
      field('Job offer option', offerTier ? int(r.offerOption) : '—', !offerTier),
      field('New score', `${int(r.score)} (${r.score - crs >= 0 ? '+' : ''}${r.score - crs})`),
      field('Projected CEC cutoff', int(projected)),
    );

    if (state.years < 1) {
      applicantTally.textContent =
        `New score ${int(r.score)}. CEC needs at least a year of skilled Canadian work experience, so CEC draws can't invite you yet; general and category draws have their own cutoffs.`;
      applicantVerdict.append(stamp('NOT CEC', 'flag'));
      return;
    }

    const which = offerTier
      ? r.uses === 'offer'
        ? `The job offer counts (${r.offerOption} beats ${r.experienceOption}).`
        : `Your experience counts (${r.experienceOption} beats ${r.offerOption}), so the job offer doesn't change your score.`
      : '';
    const verdict =
      margin >= 0
        ? `${int(r.score)} clears the projected cutoff by ${margin}.`
        : `${int(r.score)} is ${-margin} short of the projected cutoff.`;
    // Only worth saying when an offer in the applicant's own tier would actually win.
    const ownTierOffer = occ?.tier ? hw.points.offer[occ.tier] : 0;
    const hint = !offerTier && ownTierOffer > r.experienceOption
      ? ` A job offer in this occupation would count instead: ${int(crs - r.workLength + ownTierOffer)}.`
      : '';
    applicantTally.textContent = `${which ? `${which} ` : ''}${verdict}${hint}`;
    applicantVerdict.append(stamp(margin >= 0 ? 'APPROVED' : 'DENIED', margin >= 0 ? 'approved' : 'denied'));
  };

  /* Wiring */
  const rerunApplicant = () => update();
  crsInput.addEventListener('input', rerunApplicant);
  occInput.addEventListener('input', rerunApplicant);
  yearBox.addEventListener('change', rerunApplicant);
  spouseBox.addEventListener('change', rerunApplicant);
  yearsSelect.addEventListener('change', rerunApplicant);
  offerSelect.addEventListener('change', rerunApplicant);

  baseSelect.addEventListener('change', () => {
    proj.baseIndex = Number(baseSelect.value);
    proj.size = null;
    proj.reach = null;
    update();
  });
  sizeInput.addEventListener('input', () => {
    const v = Number(sizeInput.value);
    proj.size = Number.isFinite(v) && v > 0 ? v : null;
    update();
  });
  presetSelect.addEventListener('change', () => { applyPreset(presetSelect.value); update(); });
  tierInputs.forEach((input, i) =>
    input.addEventListener('input', () => {
      proj.percents[i] = Number(input.value) || 0;
      proj.presetKey = 'custom';
      presetSelect.value = 'custom';
      update();
    }),
  );
  reachInput.addEventListener('input', () => {
    const v = Number(reachInput.value);
    proj.reach = Number.isFinite(v) && v > 0 ? Math.min(100, v) / 100 : null;
    update();
  });

  const control = (label: string, forId: string, input: HTMLElement, hint?: HTMLElement) =>
    el('div', { class: 'hw-control' }, el('label', { class: 'inspect__label', text: label, attrs: { for: forId } }), input, hint ?? null);

  const applicantPaper = el(
    'article',
    { class: 'paper' },
    el('div', { class: 'paper__band paper__band--olive' }, el('span', { text: 'Applicant Verification' }), el('span', { text: 'Your score' })),
    el(
      'div',
      { class: 'paper__body' },
      el('h2', { class: 'paper__title pixel', text: 'Score Check' }),
      el('p', { class: 'paper__note', text: 'Your score under the new rules, against the projected cutoff below. Your current CRS already includes your Canadian work-length points; the new factor replaces them with the higher of experience and a job offer. Nothing you enter leaves this browser.' }),
      el(
        'form',
        { class: 'inspect hw-form', on: { submit: (e) => { e.preventDefault(); update(); } } },
        el('div', { class: 'inspect__group' }, el('label', { class: 'inspect__label', text: 'CRS today', attrs: { for: 'hw-crs' } }), crsInput),
        el('div', { class: 'inspect__group hw-grow' }, el('label', { class: 'inspect__label', text: 'Your occupation', attrs: { for: 'hw-occ' } }), occInput, datalist),
      ),
      occStamp,
      el(
        'div',
        { class: 'hw-grid hw-grid--form' },
        control(
          'Canadian work experience (total)',
          'hw-years',
          yearsSelect,
          el('p', { class: 'hw-hint', text: 'As on your profile. Your CRS today already counts these years, so changing one without the other describes a different applicant.' }),
        ),
        control('Qualifying job offer', 'hw-offer', offerSelect),
      ),
      el(
        'div',
        { class: 'hw-checks' },
        el('label', { class: 'hw-check' }, yearBox, el('span', { text: 'At least 12 months of it was in the occupation above' })),
        el('label', { class: 'hw-check' }, spouseBox, el('span', { text: 'I have a spouse or partner coming with me' })),
      ),
      el('div', { class: 'hw-result' }, applicantFields, applicantVerdict),
      applicantTally,
    ),
  );

  const projectionPaper = el(
    'article',
    { class: 'paper' },
    el('div', { class: 'paper__band' }, el('span', { text: 'Projection' }), el('span', { text: 'Next CEC draw' })),
    el(
      'div',
      { class: 'paper__body' },
      el('h2', { class: 'paper__title pixel', text: 'Projected Cut-off' }),
      el(
        'div',
        { class: 'figure hw-figure' },
        el('span', { class: 'figure__label', text: 'Today' }),
        figureBefore,
        el('span', { class: 'figure__label', text: '→' }),
        figureAfter,
        figureDelta,
      ),
      actualLine,
      baseNote,
      el(
        'div',
        { class: 'hw-legend' },
        el('span', {}, el('i', { class: 'shift-key shift-key--today' }), 'Today'),
        el('span', {}, el('i', { class: 'shift-key shift-key--after' }), 'With high-wage points'),
      ),
      chartHost,
      el('p', { class: 'hw-hint', text: 'Candidates a CEC draw can reach, per 5-point bin. 601+ is left out: those are PNP nominees. Job offers are not modelled: everyone a CEC draw reaches has 1+ year of Canadian experience, so an offer in their own tier never beats it.' }),
      el(
        'details',
        { class: 'hw-assumptions' },
        el('summary', { class: 'inspect__label', text: 'Assumptions' }),
        el(
          'div',
          { class: 'hw-grid' },
          control('Base round (pool snapshot)', 'hw-base', baseSelect),
          control('Draw size', 'hw-size', sizeInput),
          control('Who is in which tier', 'hw-preset', presetSelect, presetNote),
          el(
            'div',
            { class: 'hw-control' },
            el('span', { class: 'inspect__label', text: 'Tier shares (%)' }),
            el(
              'div',
              { class: 'hw-tiers' },
              ...(['2.0x', '1.5x', '1.3x'] as WageTier[]).map((t, i) =>
                el('label', { class: 'hw-tier', attrs: { for: tierInputs[i]!.id } }, el('span', { text: TIER_LABEL[t] }), tierInputs[i]!),
              ),
              el('span', { class: 'hw-tier' }, el('span', { text: 'Not listed' }), noneOut),
            ),
          ),
          control('Reach (%)', 'hw-reach', reachInput, reachNote),
        ),
      ),
    ),
    el(
      'div',
      { class: 'paper__body paper__body--flush' },
      el(
        'table',
        { class: 'ledger' },
        el('thead', {}, el('tr', {}, el('th', { text: 'Invited at the projected cutoff' }), el('th', { class: 'num', text: 'Candidates' }), el('th', { class: 'num', text: 'Share' }))),
        tierBody,
      ),
    ),
  );

  syncTierInputs();
  update();
  return el('div', {}, applicantPaper, projectionPaper);
}

/* ── Method and sources ────────────────────────────────────────────────────── */

function finePrint(hw: HighWage) {
  const link = (text: string, href: string) => el('a', { text, attrs: { href, rel: 'noopener' } });
  return el(
    'article',
    { class: 'paper' },
    el('div', { class: 'paper__band paper__band--rust' }, el('span', { text: 'Fine print' }), el('span', { text: 'Estimate, not advice' })),
    el(
      'div',
      { class: 'paper__body' },
      el(
        'ul',
        { class: 'hw-rules hw-rules--fine' },
        el('li', {}, 'IRCC publishes the pool in bands. Scores are spread evenly inside each band, except 501–600, which is assumed to thin out from the 491–500 level. In 2024, 25,304 new profiles scored 501–550 against 1,973 at 551–600.'),
        el('li', {}, 'IRCC does not say how much of the pool is CEC-eligible. The reach is set so the chosen snapshot reproduces that round’s real cutoff, and is assumed equal at every score.'),
        el('li', {}, 'Tiers are assumed independent of score. If high-wage workers already score higher, the real cutoff rises further than shown.'),
        el('li', {}, 'This is the first draw after rescoring only: no new profiles, no change in draw size, no new category draws.'),
        el('li', {}, 'Tier-share sources: 2021 Census employment in TEER 0–3 occupations (Statistics Canada tables 98-10-0449, 98-10-0316, 98-10-0585), and the top 15 occupations of invited candidates in IRCC’s Express Entry Year-End Report 2024. Temporary-resident shares are estimated from 4-digit occupation groups.'),
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
