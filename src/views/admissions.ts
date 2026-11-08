import { monthsLabel, planLabel, renderAdmissionsChart, STANDING_LABEL, standingOf } from '../chart/admissions';
import { el, field } from '../dom';
import { dash, int, stampDate } from '../format';
import type { Admissions, AdmissionsKey, AdmissionsYear, PlanFigure } from '../types';

/**
 * Admissions — how many people actually became permanent residents each year,
 * against how many the immigration levels plan said would.
 *
 * This is the far end of the pipeline the rest of the site tracks. An ITA is an
 * invitation to apply; an admission is a landing — the day PR status is granted,
 * whether at a port of entry or from inside Canada. The two are counted by
 * different systems, months or years apart, and many admissions (family, refugee,
 * most PNP) never pass through Express Entry at all.
 */

/** What each category does and doesn't include, in the plan's terms. */
const SCOPE: Record<AdmissionsKey, string> = {
  total: 'Every new permanent resident, in every class.',
  economic: 'Every economic program: Express Entry federal programs, provincial nominees, Quebec-selected workers and business immigrants, pilots, caregivers and the Atlantic program.',
  fhs: 'The three federal Express Entry programs — Canadian Experience Class, Federal Skilled Worker and Federal Skilled Trades — outside Quebec. Provincial nominees selected through Express Entry count under PNP, as they do in the plan.',
  pnp: 'Provincial and territorial nominees, through Express Entry or a province’s base stream. Quebec runs its own selection and has no PNP.',
  family: 'Sponsored spouses, partners, children, parents and grandparents.',
  refugees: 'Resettled refugees (government-assisted, privately sponsored, blended) and protected persons in Canada.',
  humanitarian: 'Humanitarian and compassionate cases, public policies and permit holders — IRCC’s “all other immigration”.',
};

/** Survives a re-render from the tabs; the category is the reader's choice, not the route's. */
let selected: AdmissionsKey = 'total';

const pct = (n: number) => `${(n * 100).toFixed(0)}%`;
const range = (f: PlanFigure | null) =>
  f?.low != null && f.high != null ? `${int(f.low)} – ${int(f.high)}` : dash;

export function renderAdmissions(data: Admissions | null): HTMLElement {
  if (!data) {
    return el(
      'article',
      { class: 'paper' },
      el('div', { class: 'paper__band paper__band--rust' }, el('span', { text: 'Discrepancy' })),
      el(
        'div',
        { class: 'paper__body' },
        el('h2', { class: 'paper__title pixel', text: 'Admissions unavailable' }),
        el('p', { class: 'paper__note', text: 'The admissions file could not be loaded. The rest of the site is unaffected.' }),
      ),
    );
  }

  const labelOf = (key: AdmissionsKey) => data.categories.find((c) => c.key === key)?.label ?? key;

  const headline = el('div', {});
  const chartHost = el('div', { class: 'chart__host' });
  const scope = el('p', { class: 'paper__note' });
  const tableHost = el('div', { class: 'ledger__host' });
  let dispose: (() => void) | null = null;

  const update = () => {
    scope.textContent = SCOPE[selected];
    headline.replaceChildren(...headlineFor(data, selected));
    dispose?.();
    dispose = renderAdmissionsChart(chartHost, { years: data.years, category: selected, categoryLabel: labelOf(selected) });
    tableHost.replaceChildren(yearTable(data.years, selected));
  };

  const categorySelect = el(
    'select',
    {
      class: 'control__input',
      attrs: { id: 'adm-category' },
      on: {
        change: (e) => {
          selected = (e.target as HTMLSelectElement).value as AdmissionsKey;
          update();
        },
      },
    },
    ...data.categories.map((c) =>
      el('option', { text: c.label, attrs: { value: c.key, ...(c.key === selected ? { selected: 'selected' } : {}) } })),
  );

  const view = el(
    'div',
    {},
    el(
      'div',
      { class: 'controls' },
      el(
        'div',
        { class: 'control' },
        el('label', { class: 'control__label', text: 'Immigration class', attrs: { for: 'adm-category' } }),
        categorySelect,
      ),
    ),
    el(
      'article',
      { class: 'paper' },
      el(
        'div',
        { class: 'paper__band' },
        el('span', { text: 'Admissions' }),
        // Short enough to keep the band on one line at phone width.
        el('span', { text: `To ${stampDate(`${data.source.through}-01`).slice(3)}` }),
      ),
      el(
        'div',
        { class: 'paper__body' },
        headline,
        el(
          'div',
          { class: 'hw-legend adm-legend' },
          el('span', {}, el('i', { class: 'adm-key adm-key--within' }), 'At or under target'),
          el('span', {}, el('i', { class: 'adm-key adm-key--over' }), 'Over target, within range'),
          el('span', {}, el('i', { class: 'adm-key adm-key--outside' }), 'Outside range'),
          el('span', {}, el('i', { class: 'adm-key adm-key--partial' }), 'Year to date'),
          el('span', {}, el('i', { class: 'adm-key adm-key--target' }), 'Target'),
          el('span', {}, el('i', { class: 'adm-key adm-key--range' }), 'Planning range'),
          el('span', {}, el('i', { class: 'adm-key adm-key--earlier' }), 'An earlier plan’s figure'),
        ),
        chartHost,
        scope,
      ),
    ),
    el(
      'article',
      { class: 'paper' },
      el(
        'div',
        { class: 'paper__band paper__band--olive' },
        el('span', { text: 'Ledger' }),
        el('span', { text: 'By calendar year' }),
      ),
      el('div', { class: 'paper__body paper__body--flush' }, tableHost),
    ),
    plansPaper(data),
    methodPaper(data),
  );

  update();
  return view;
}

/** The year in progress if there is one, else the last complete year. */
function headlineFor(data: Admissions, key: AdmissionsKey): HTMLElement[] {
  const reported = data.years.filter((y) => y.monthsReported > 0);
  const current = reported[reported.length - 1];
  if (!current?.actual) return [];

  const out: HTMLElement[] = [];
  const f = current.target?.values[key] ?? null;
  const actual = current.actual[key];
  const partial = current.monthsReported < 12;

  out.push(
    el(
      'div',
      { class: 'figure' },
      el('span', { class: 'figure__value', text: int(actual) }),
      el('span', {
        class: 'figure__label',
        text: partial ? `admitted ${monthsLabel(current.monthsReported)} ${current.year}` : `admitted in ${current.year}`,
      }),
    ),
  );

  const fields: HTMLElement[] = [];
  if (current.target) {
    fields.push(field(
      `${current.year} target · ${planLabel(current.target.plan)} plan`,
      f?.target ? int(f.target) : f ? 'Range only' : 'None set',
      !f?.target,
    ));
    fields.push(field('Planning range', range(f), !f));
  }
  if (partial && f?.target) {
    // Months elapsed is the fair yardstick for a partial year, not the full target.
    // Admissions are lumpy — December is often heavy — so this is a pace check,
    // not a forecast, and none is offered.
    fields.push(field(
      'Share of target reached',
      `${pct(actual / f.target)} with ${pct(current.monthsReported / 12)} of the year gone`,
    ));
  }
  if (partial && current.priorSamePeriod) {
    const prior = current.priorSamePeriod[key];
    const change = prior ? (actual - prior) / prior : null;
    fields.push(field(
      `Same months of ${current.year - 1}`,
      `${int(prior)}${change === null ? '' : ` (${change >= 0 ? '+' : '−'}${Math.abs(change * 100).toFixed(1)}%)`}`,
    ));
  }
  out.push(el('div', { class: 'fields adm-fields' }, ...fields));

  // Plan notes for the year in progress — e.g. 2026's one-time initiatives, which
  // sit outside the target and explain a class running well past it.
  const plan = current.target ? data.plans.find((p) => p.key === current.target!.plan) : null;
  for (const note of plan?.notes ?? []) out.push(el('p', { class: 'paper__note', text: note }));

  return out;
}

function yearTable(years: AdmissionsYear[], key: AdmissionsKey) {
  const head = el(
    'tr',
    {},
    el('th', { text: 'Year', attrs: { scope: 'col' } }),
    el('th', { class: 'num', text: 'Admitted', attrs: { scope: 'col' } }),
    el('th', { class: 'num', text: 'Target', attrs: { scope: 'col' } }),
    el('th', { class: 'num', text: 'Range', attrs: { scope: 'col' } }),
    el('th', { class: 'num', text: 'Of target', attrs: { scope: 'col' } }),
    el('th', { text: 'Against plan', attrs: { scope: 'col' } }),
    el('th', { text: 'Set in', attrs: { scope: 'col' } }),
    el('th', { text: 'Earlier plans', attrs: { scope: 'col' } }),
  );

  const body = el('tbody', {});
  for (const y of [...years].reverse()) {
    const f = y.target?.values[key] ?? null;
    const actual = y.monthsReported > 0 ? y.actual?.[key] ?? null : null;
    const complete = y.monthsReported === 12;
    // A year in progress is only labelled once it has crossed something.
    const s = complete || standingOf(y, key) !== 'within' ? standingOf(y, key) : null;
    const earlier = y.versions
      .filter((v) => v.plan !== y.target?.plan && v.values[key]?.target)
      .map((v) => `${int(v.values[key]!.target)} (${planLabel(v.plan)})`)
      .join(', ');

    body.append(el(
      'tr',
      {},
      el('td', { text: String(y.year) }),
      el('td', {
        class: `num strong${complete ? '' : ' muted'}`,
        text: actual === null ? dash : complete ? int(actual) : `${int(actual)} (${monthsLabel(y.monthsReported).toLowerCase()})`,
      }),
      el('td', { class: 'num', text: f?.target ? int(f.target) : dash }),
      el('td', { class: 'num', text: range(f) }),
      el('td', { class: 'num', text: actual !== null && complete && f?.target ? `${((actual / f.target) * 100).toFixed(1)}%` : dash }),
      el('td', { text: s ? STANDING_LABEL[s] : dash }),
      el('td', { text: y.target ? `${planLabel(y.target.plan)}${y.target.notional ? ' (notional)' : ''}` : dash }),
      el('td', { class: 'muted', text: earlier || dash }),
    ));
  }

  return el(
    'div',
    { class: 'ledger__scroll' },
    el('table', { class: 'ledger' }, el('thead', {}, head), body),
  );
}

function plansPaper(data: Admissions) {
  const body = el('tbody', {});
  for (const p of [...data.plans].reverse()) {
    body.append(el(
      'tr',
      {},
      el('td', {}, el('a', { text: planLabel(p.key), attrs: { href: p.url, rel: 'noopener' } })),
      el('td', { text: stampDate(p.tabled) }),
      el('td', { class: 'adm-notes', text: p.notes.join(' ') || dash }),
    ));
  }
  return el(
    'article',
    { class: 'paper' },
    el(
      'div',
      { class: 'paper__band paper__band--olive' },
      el('span', { text: 'Plans on file' }),
      el('span', { text: 'Immigration levels plans' }),
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
          el('thead', {}, el(
            'tr',
            {},
            el('th', { text: 'Plan', attrs: { scope: 'col' } }),
            el('th', { text: 'Tabled', attrs: { scope: 'col' } }),
            el('th', { text: 'Notes', attrs: { scope: 'col' } }),
          )),
          body,
        ),
      ),
    ),
  );
}

function methodPaper(data: Admissions) {
  const note = (text: string) => el('p', { class: 'paper__note', text });
  return el(
    'article',
    { class: 'paper' },
    el('div', { class: 'paper__band' }, el('span', { text: 'How to read this' })),
    el(
      'div',
      { class: 'paper__body' },
      note('An admission is a landing: the day someone becomes a permanent resident, at a port of entry or from inside Canada. It is not an invitation to apply. An ITA in Express Entry usually turns into an admission six months to a year later, if it does at all, and family, refugee and most provincial-nominee admissions never go through Express Entry.'),
      note('Each year’s target is the one set by the plan that starts with that year. Plans cover three years, and their later years are notional: they get revised, sometimes a lot. The 2025 target was 500,000 in two successive plans before the 2025–2027 plan cut it to 395,000. Those earlier figures appear as open rings on the chart.'),
      note('Admissions come from IRCC’s monthly open data, by province and immigration class. IRCC rounds every cell to the nearest 5 and shows counts of 1 to 4 as “--”, which this page counts as zero. The overall totals are IRCC’s own; the class figures are summed from province rows and can differ from IRCC’s published class totals by a few dozen. Recent months are preliminary and do get revised.'),
      el(
        'p',
        { class: 'paper__note' },
        'Sources: ',
        el('a', { text: 'Permanent Residents – Monthly IRCC Updates', attrs: { href: data.source.dataset, rel: 'noopener' } }),
        ` (data to ${stampDate(data.source.asOf)}) and the levels plans listed above.`,
      ),
    ),
  );
}
