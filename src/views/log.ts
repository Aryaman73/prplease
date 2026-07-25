import { renderTimeline } from '../chart/timeline';
import { el } from '../dom';
import { int, stampDate, stampDateTime } from '../format';
import type { Draws, Round } from '../types';

const RANGES = [
  { key: 'all', label: 'All time', years: null },
  { key: '10y', label: '10 years', years: 10 },
  { key: '5y', label: '5 years', years: 5 },
  { key: '2y', label: '2 years', years: 2 },
  { key: '1y', label: '1 year', years: 1 },
] as const;

/** Most readers arrive asking about recent CEC draws, so open on that slice. */
const DEFAULT_RANGE = '1y';
const DEFAULT_CATEGORY = 'cec';

export function renderLog(draws: Draws): HTMLElement {
  const hasDefaultCategory = draws.categories.some((c) => c.key === DEFAULT_CATEGORY);
  let category: string | null = hasDefaultCategory ? DEFAULT_CATEGORY : null;
  let range: (typeof RANGES)[number] =
    RANGES.find((r) => r.key === DEFAULT_RANGE) ?? RANGES[0];

  const chartHost = el('div', { class: 'chart__host' });
  const tableHost = el('div', { class: 'ledger__host' });
  const summary = el('p', { class: 'ledger__summary' });
  let disposeChart: (() => void) | null = null;

  /** Period and category both scope the chart and the ledger identically. */
  const scoped = (): Round[] => {
    let rounds = draws.rounds;
    if (range.years !== null) {
      const floor = Date.now() - range.years * 365.25 * 86_400_000;
      rounds = rounds.filter((r) => Date.parse(r.date) >= floor);
    }
    if (category !== null) rounds = rounds.filter((r) => r.category === category);
    return rounds;
  };

  const update = () => {
    const rounds = scoped();
    const label = category
      ? draws.categories.find((c) => c.key === category)?.label ?? category
      : null;

    disposeChart?.();
    // Only one category on the plot means a trend line is meaningful, and the
    // y-axis fits that category instead of being stretched by every other one.
    disposeChart = renderTimeline(chartHost, {
      rounds,
      connect: category !== null,
      label: label ? `${label} draws` : null,
    });

    summary.textContent = label
      ? `${int(rounds.length)} ${label} draws · ${range.label.toLowerCase()}`
      : `${int(rounds.length)} draws · ${range.label.toLowerCase()}`;

    tableHost.replaceChildren(ledger(rounds));
  };

  const categorySelect = el(
    'select',
    {
      class: 'control__input',
      attrs: { id: 'filter-category' },
      on: {
        change: (e) => {
          const value = (e.target as HTMLSelectElement).value;
          category = value === 'all' ? null : value;
          update();
        },
      },
    },
    el('option', { text: `All categories (${int(draws.rounds.length)})`, attrs: { value: 'all' } }),
    ...[...draws.categories]
      .sort((a, b) => b.count - a.count)
      .map((c) =>
        el('option', {
          text: `${c.label} (${int(c.count)})`,
          attrs: { value: c.key, ...(c.key === category ? { selected: 'selected' } : {}) },
        }),
      ),
  );

  const rangeSelect = el(
    'select',
    {
      class: 'control__input',
      attrs: { id: 'filter-range' },
      on: {
        change: (e) => {
          const value = (e.target as HTMLSelectElement).value;
          range = RANGES.find((r) => r.key === value) ?? RANGES[0];
          update();
        },
      },
    },
    ...RANGES.map((r) =>
      el('option', {
        text: r.label,
        attrs: { value: r.key, ...(r.key === range.key ? { selected: 'selected' } : {}) },
      }),
    ),
  );

  // One filter row, above everything it scopes — both the chart and the ledger
  // re-render against the same slice, so the two can never disagree.
  const controls = el(
    'div',
    { class: 'controls' },
    el(
      'div',
      { class: 'control' },
      el('label', { class: 'control__label', text: 'Period', attrs: { for: 'filter-range' } }),
      rangeSelect,
    ),
    el(
      'div',
      { class: 'control' },
      el('label', { class: 'control__label', text: 'Category', attrs: { for: 'filter-category' } }),
      categorySelect,
    ),
  );

  const view = el(
    'div',
    {},
    controls,
    el(
      'article',
      { class: 'paper' },
      el(
        'div',
        { class: 'paper__band' },
        el('span', { text: 'Entry Log' }),
        el('span', { text: 'CRS cut-off by draw' }),
      ),
      el('div', { class: 'paper__body' }, summary, chartHost),
    ),
    el(
      'article',
      { class: 'paper' },
      el(
        'div',
        { class: 'paper__band paper__band--olive' },
        el('span', { text: 'Ledger' }),
        el('span', { text: 'Matching rounds' }),
      ),
      el('div', { class: 'paper__body paper__body--flush' }, tableHost),
    ),
  );

  update();
  return view;
}

/**
 * The table view. Every value the chart encodes is readable here without
 * hovering, which is what keeps the tooltip an enhancement rather than a gate.
 */
function ledger(rounds: Round[]) {
  const head = el(
    'tr',
    {},
    el('th', { text: 'No.', attrs: { scope: 'col' } }),
    el('th', { text: 'Date', attrs: { scope: 'col' } }),
    el('th', { text: 'Category', attrs: { scope: 'col' } }),
    el('th', { class: 'num', text: 'ITAs', attrs: { scope: 'col' } }),
    el('th', { class: 'num', text: 'CRS', attrs: { scope: 'col' } }),
    el('th', { text: 'Tie-break', attrs: { scope: 'col' } }),
  );

  const body = el('tbody', {});
  for (const r of rounds) {
    const tie = el('td', {
      class: r.tieBreak ? '' : 'muted',
      text: r.tieBreak ? stampDate(r.tieBreak) : '—',
    });
    if (r.tieBreak) tie.title = stampDateTime(r.tieBreak);

    body.append(
      el(
        'tr',
        {},
        el('td', { class: 'num', text: r.number }),
        el('td', { text: stampDate(r.date) }),
        el('td', { text: r.categoryLabel }),
        el('td', { class: 'num', text: int(r.invitations) }),
        el('td', { class: 'num strong', text: int(r.crsCutoff) }),
        tie,
      ),
    );
  }

  if (rounds.length === 0) {
    body.append(
      el('tr', {}, el('td', {
        class: 'empty',
        attrs: { colspan: '6' },
        text: 'No draws match the current filter.',
      })),
    );
  }

  return el(
    'div',
    { class: 'ledger__scroll' },
    el('table', { class: 'ledger' }, el('thead', {}, head), body),
  );
}
