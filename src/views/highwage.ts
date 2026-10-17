import { renderShift } from '../chart/shift';
import { el, field } from '../dom';
import { int, stampDate } from '../format';
import { project, sharesFromPercents, TIERS } from '../highwage/model';
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
/** Occupation median pay against the national median, as the table's row label. */
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

function measuredAt(round: Round): number {
  const t = round.poolAsOf ? Date.parse(round.poolAsOf) : Number.NaN;
  return Number.isNaN(t) ? Date.parse(round.date) : t;
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
  // Newest first. Only snapshots measured before the change can be projected from.
  const bases = cecRounds.filter((r) => measuredAt(r) < effective).slice(0, 12);
  // The first CEC round held under the new rules, if there has been one.
  const actual = [...cecRounds].reverse().find((r) => Date.parse(`${r.date}T00:00:00Z`) >= effective) ?? null;

  return el(
    'div',
    {},
    directive(hw),
    // Spread, not wrapped: papers are spaced by `.paper + .paper`, which only
    // matches siblings, so a wrapper element would leave them touching.
    ...(bases.length ? applicantAndProjection(hw, bases, actual) : [el('p', { class: 'empty', text: 'No CEC pool snapshot to project from.' })]),
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
        `From ${longDate(hw.effective)}, Express Entry adds a bonus for at least 12 months of Canadian work experience in ${listed} occupations IRCC classes as high-wage: those where the median pay across Canada is at least 1.3 times the national median. The bonus goes on top of the Canadian experience points you already get, and is applied automatically. `,
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
        `A job offer in a listed occupation (${hw.points.offer['2.0x']} / ${hw.points.offer['1.5x']} / ${hw.points.offer['1.3x']}, no LMIA needed) replaces your Canadian experience points instead of adding to them. With a year or more of Canadian experience, as everyone in a CEC draw has, experience beats an offer in the same tier, so this page leaves job offers out.`,
      ),
    ),
  );
}

/* ── Score check + projection (they share one projected cutoff) ───────────── */

function applicantAndProjection(hw: HighWage, bases: Round[], actual: Round | null): HTMLElement[] {
  const applicant = load();
  const defaultPreset = hw.presets.find((p) => p.key === hw.defaultPreset) ?? hw.presets[0]!;

  const proj = {
    baseIndex: 0,
    presetKey: defaultPreset.key as string,
    percents: [defaultPreset.shares['2.0x'], defaultPreset.shares['1.5x'], defaultPreset.shares['1.3x']].map((v) =>
      Math.round(v * 1000) / 10,
    ) as [number, number, number],
    size: null as number | null,
  };

  let disposeChart: (() => void) | null = null;

  /* Applicant inputs */
  const crsInput = el('input', {
    class: 'inspect__input pixel',
    attrs: { id: 'hw-crs', type: 'number', min: '0', max: '1200', inputmode: 'numeric', placeholder: '000', autocomplete: 'off' },
  });
  crsInput.value = applicant.crs;

  let tier: WageTier | 'none' = applicant.tier;
  const tierRadios = (['none', '1.3x', '1.5x', '2.0x'] as const).map((value) => {
    const radio = el('input', {
      class: 'scope__radio',
      attrs: { type: 'radio', name: 'hw-tier', value },
      on: { change: () => { tier = value; update(); } },
    });
    const points = value === 'none' ? '+0' : `+${hw.points.experience[value]}`;
    return {
      value,
      radio,
      label: el('label', { class: 'scope__option' }, radio, el('span', { text: `${TIER_LABEL[value]} ${points}` })),
    };
  });
  const setTier = (value: WageTier | 'none') => {
    tier = value;
    update();
  };

  const applicantFields = el('div', { class: 'fields hw-fields' });
  const applicantTally = el('p', { class: 'inspect__tally' });

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
  const tierInputs = (['2.0x', '1.5x', '1.3x'] as WageTier[]).map((t) =>
    el('input', { class: 'hw-input hw-input--num', attrs: { id: `hw-t-${t}`, type: 'number', min: '0', max: '100', step: '0.5' } }),
  );
  const noneOut = el('output', { class: 'hw-none', attrs: { for: tierInputs.map((i) => i.id).join(' ') } });

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
    });

    // Assumption read-outs
    noneOut.textContent = `${(shares.none * 100).toFixed(1)}%`;
    if (proj.size === null) sizeInput.value = String(base.invitations ?? '');

    if (!result) {
      figureBefore.textContent = '—';
      figureAfter.textContent = '—';
      figureDelta.textContent = '';
      baseNote.textContent = `Round No. ${base.number} has an incomplete pool snapshot.`;
      return;
    }


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
    save({ crs: crsInput.value, tier });
    for (const r of tierRadios) r.radio.checked = r.value === tier;

    applicantFields.replaceChildren();
    applicantTally.textContent = '';
    const crs = Number(crsInput.value);
    if (!crsInput.value.trim() || !Number.isFinite(crs) || crs < 0 || crs > 1200) {
      applicantFields.append(el('p', { class: 'empty', text: 'Enter your current CRS score and pick your tier to see your new score.' }));
      return;
    }

    const bonus = tier === 'none' ? 0 : hw.points.experience[tier];
    const score = crs + bonus;
    const margin = score - projected;

    applicantFields.append(
      field('Score today', int(crs)),
      field('High-wage bonus', `+${bonus}`),
      field('New score', int(score)),
      field('Projected CEC cutoff', int(projected)),
    );
    applicantTally.textContent =
      margin >= 0
        ? `${int(score)} clears the projected cutoff by ${margin}.`
        : `${int(score)} is ${-margin} short of the projected cutoff.`;
  };

  /* Wiring */
  const rerunApplicant = () => update();
  crsInput.addEventListener('input', rerunApplicant);

  baseSelect.addEventListener('change', () => {
    proj.baseIndex = Number(baseSelect.value);
    proj.size = null;
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

  const control = (label: string, forId: string, input: HTMLElement, hint?: HTMLElement) =>
    el('div', { class: 'hw-control' }, el('label', { class: 'inspect__label', text: label, attrs: { for: forId } }), input, hint ?? null);

  const applicantPaper = el(
    'article',
    { class: 'paper' },
    el('div', { class: 'paper__band paper__band--olive' }, el('span', { text: 'Applicant Verification' })),
    el(
      'div',
      { class: 'paper__body' },
      el('h2', { class: 'paper__title pixel', text: 'Score Check' }),
      el('p', { class: 'paper__note', text: 'For people in Canada applying through CEC, with a year or more of skilled Canadian work experience. The bonus needs at least 12 months of that experience in a listed occupation; pick the tier of that occupation. Nothing you enter leaves this browser.' }),
      el(
        'form',
        { class: 'inspect', on: { submit: (e) => { e.preventDefault(); update(); } } },
        el('div', { class: 'inspect__group' }, el('label', { class: 'inspect__label', text: 'CRS today', attrs: { for: 'hw-crs' } }), crsInput),
        el(
          'fieldset',
          { class: 'scope' },
          el('legend', { class: 'inspect__label', text: "Your occupation's tier" }),
          ...tierRadios.map((r) => r.label),
        ),
      ),
      el('p', { class: 'hw-hint', text: "Don't know your tier? Look up your NOC above." }),
      el('div', { class: 'hw-result' }, applicantFields),
      applicantTally,
      el('p', {
        class: 'hw-hint',
        text: 'Job offers are not included (see Job offers above). Years of experience and spouse status do not change the result: the bonus is added to the length points already in your score.',
      }),
    ),
  );

  const projectionPaper = el(
    'article',
    { class: 'paper' },
    el('div', { class: 'paper__band' }, el('span', { text: 'Projection' })),
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
      el('p', { class: 'hw-hint', text: 'Candidates a CEC draw can reach, per 5-point bin. 601+ is left out: those are PNP nominees.' }),
      el(
        'section',
        { class: 'hw-assumptions' },
        el('h3', { class: 'inspect__label', text: 'Assumptions' }),
        el(
          'div',
          { class: 'hw-grid' },
          control('Base round (pool snapshot)', 'hw-base', baseSelect),
          control('Draw size', 'hw-size', sizeInput),
          control('Who is in which tier', 'hw-preset', presetSelect),
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
        ),
      ),
    ),
    el(
      'div',
      { class: 'paper__body hw-caption' },
      el('h3', { class: 'inspect__label hw-subhead', text: 'Invited at the projected cutoff' }),
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
          el('thead', {}, el('tr', {}, el('th', { text: 'Tier' }), el('th', { class: 'num', text: 'Candidates' }), el('th', { class: 'num', text: 'Share' }))),
          tierBody,
        ),
      ),
    ),
  );

  syncTierInputs();
  update();
  return [occupationLookup(hw, setTier), applicantPaper, projectionPaper];
}

/* ── NOC lookup ────────────────────────────────────────────────────────────── */

function occupationLookup(hw: HighWage, onPick: (tier: WageTier | 'none') => void) {
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
          el(
            'span',
            { class: 'verdict__mark' },
            el('button', {
              class: 'hw-pick',
              text: 'Use',
              attrs: { type: 'button', 'aria-label': `Use ${o.title} (${label}) in the score check` },
              on: {
                click: () => {
                  onPick(o.tier ?? 'none');
                  status.textContent = `Score check set to ${o.tier ? TIER_LABEL[o.tier] : 'Not listed'} (${o.noc}).`;
                },
              },
            }),
          ),
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
        el('li', {}, 'IRCC publishes the pool in bands. Scores are spread evenly inside each band, except 501–600, which is assumed to thin out from the 491–500 level. In 2024, 25,304 new profiles scored 501–550 against 1,973 at 551–600.'),
        el('li', {}, 'A CEC draw can only invite CEC-eligible candidates, and IRCC does not say how many of the pool that is. The model assumes they are the same share at every score, and takes that share from the snapshot itself: it is whatever reproduces the round’s real cutoff, so it never needs setting by hand. If CEC candidates bunch at particular scores, the projection is off by that much.'),
        el('li', {}, 'Tiers are assumed independent of score. If high-wage workers already score higher, the real cutoff rises further than shown.'),
        el('li', {}, 'This is the first draw after rescoring only: no new profiles, no change in draw size, no new category draws.'),
        el('li', {}, '“Who is in which tier” sources. The Census options use 2021 Census employment in TEER 0–3 occupations (Statistics Canada tables 98-10-0449, 98-10-0316, 98-10-0585); temporary-resident shares are estimated from 4-digit occupation groups. The IRCC invitee options use the 15 most common occupations of invited candidates in IRCC’s Express Entry Year-End Report 2024, which cover only about a third of invitations. “Top 15 only” assumes the rest look the same; the default instead fills the other two-thirds with the temporary-resident mix, since those top 15 lean heavily on software jobs.'),
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
