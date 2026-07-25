import { poolSnapshots, renderPool, type PoolMode } from '../chart/pool';
import { el } from '../dom';
import { int, stampDate } from '../format';
import type { Band, Draws, Round } from '../types';

const RANGES = [
  { key: 'all', label: 'All time', years: null },
  { key: '5y', label: '5 years', years: 5 },
  { key: '2y', label: '2 years', years: 2 },
  { key: '1y', label: '1 year', years: 1 },
] as const;

/** Composition moves slowly, so a two-year window is where a trend is visible. */
const DEFAULT_RANGE = '2y';

export function renderPoolView(draws: Draws): HTMLElement {
  // Top-level bands only, ascending. The feed also carries 10 sub-bands that
  // subdivide 451-500 and 401-450; stacking those alongside their own parents
  // would double-count the pool.
  const bands: Band[] = draws.bands
    .filter((b) => b.parent === null)
    .sort((a, b) => a.min - b.min);

  let range: (typeof RANGES)[number] = RANGES.find((r) => r.key === DEFAULT_RANGE) ?? RANGES[0];
  let mode: PoolMode = 'share';

  const chartHost = el('div', { class: 'chart__host' });
  const tableHost = el('div', { class: 'ledger__host' });
  const summary = el('p', { class: 'ledger__summary' });
  let disposeChart: (() => void) | null = null;

  const scoped = (): Round[] => {
    if (range.years === null) return draws.rounds;
    const floor = Date.now() - range.years * 365.25 * 86_400_000;
    return draws.rounds.filter((r) => Date.parse(r.date) >= floor);
  };

  const update = () => {
    const rounds = scoped();
    const snapshots = poolSnapshots(rounds, bands);

    disposeChart?.();
    disposeChart = renderPool(chartHost, { rounds, bands, mode });

    const latest = snapshots[snapshots.length - 1];
    summary.textContent = latest
      ? `${int(snapshots.length)} pool measurements · ${int(latest.total)} candidates as of ${stampDate(latest.asOf)}`
      : 'No pool snapshots in this period.';

    tableHost.replaceChildren(bandTable(snapshots, bands, mode));
  };

  const rangeSelect = el(
    'select',
    {
      class: 'control__input',
      attrs: { id: 'pool-range' },
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

  const modeSelect = el(
    'select',
    {
      class: 'control__input',
      attrs: { id: 'pool-mode' },
      on: {
        change: (e) => {
          mode = (e.target as HTMLSelectElement).value === 'absolute' ? 'absolute' : 'share';
          update();
        },
      },
    },
    el('option', { text: 'Share of pool', attrs: { value: 'share', selected: 'selected' } }),
    el('option', { text: 'Candidate counts', attrs: { value: 'absolute' } }),
  );

  const controls = el(
    'div',
    { class: 'controls' },
    el(
      'div',
      { class: 'control' },
      el('label', { class: 'control__label', text: 'Period', attrs: { for: 'pool-range' } }),
      rangeSelect,
    ),
    el(
      'div',
      { class: 'control' },
      el('label', { class: 'control__label', text: 'Display', attrs: { for: 'pool-mode' } }),
      modeSelect,
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
        el('span', { text: 'The Pool' }),
        el('span', { text: 'CRS composition' }),
      ),
      el(
        'div',
        { class: 'paper__body' },
        summary,
        el('p', {
          class: 'paper__note',
          text: 'IRCC publishes the pool distribution alongside each round. The snapshot is taken a few days before the draw it accompanies, so it is dated separately.',
        }),
        scaleLegend(bands),
        chartHost,
      ),
    ),
    el(
      'article',
      { class: 'paper' },
      el(
        'div',
        { class: 'paper__band paper__band--olive' },
        el('span', { text: 'Distribution' }),
        el('span', { text: 'Candidates by CRS band' }),
      ),
      el('div', { class: 'paper__body paper__body--flush' }, tableHost),
    ),
  );

  update();
  return view;
}

/** An ordered scale reads as a ramp, so the legend is drawn as one. */
function scaleLegend(bands: Band[]) {
  return el(
    'div',
    { class: 'ramp' },
    el('span', { class: 'ramp__cap', text: 'Lower CRS' }),
    ...bands.map((b, i) =>
      el('span', { class: `ramp__step ramp__step--${i + 1}`, attrs: { title: b.label } },
        el('span', { class: 'ramp__label', text: b.label })),
    ),
    el('span', { class: 'ramp__cap', text: 'Higher' }),
  );
}

function bandTable(
  snapshots: ReturnType<typeof poolSnapshots>,
  bands: Band[],
  mode: PoolMode,
) {
  const head = el(
    'tr',
    {},
    el('th', { text: 'Date', attrs: { scope: 'col' } }),
    ...bands.map((b) => el('th', { class: 'num', text: b.label, attrs: { scope: 'col' } })),
    el('th', { class: 'num', text: 'Total', attrs: { scope: 'col' } }),
  );

  const body = el('tbody', {});
  // Newest first, matching every other table on the site.
  for (const s of [...snapshots].reverse()) {
    body.append(
      el(
        'tr',
        {},
        el('td', { text: stampDate(s.asOf) }),
        ...s.values.map((v) =>
          el('td', {
            class: 'num',
            text: mode === 'share' ? `${((v / s.total) * 100).toFixed(1)}%` : int(v),
          }),
        ),
        el('td', { class: 'num strong', text: int(s.total) }),
      ),
    );
  }

  if (snapshots.length === 0) {
    body.append(
      el('tr', {}, el('td', {
        class: 'empty',
        attrs: { colspan: String(bands.length + 2) },
        text: 'No pool snapshots in this period.',
      })),
    );
  }

  return el(
    'div',
    { class: 'ledger__scroll' },
    el('table', { class: 'ledger' }, el('thead', {}, head), body),
  );
}
