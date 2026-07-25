import { compactInt, int, stampDate } from '../format';
import type { Band, Round } from '../types';
import { niceTicks, svgEl } from './svg';

/**
 * CRS pool composition over time — a stacked area of the seven top-level bands.
 *
 * The bands are an *ordered* scale, so they wear one hue running light→dark with
 * score rather than seven separate hues. Lowest band sits at the bottom of the
 * stack, so vertical position matches score order.
 *
 * IRCC publishes this distribution alongside each round, which is the only
 * reason a history of it exists at all.
 */

const MARGIN = { top: 14, right: 14, bottom: 30, left: 46 };
const HEIGHT = 320;
const HEIGHT_COMPACT = 240;
const COMPACT_WIDTH = 620;

export type PoolMode = 'absolute' | 'share';

export interface PoolOptions {
  rounds: Round[];
  /** Top-level bands only, ascending by score. */
  bands: Band[];
  mode: PoolMode;
}

export interface Snapshot {
  round: Round;
  /** The date the pool was measured, not the date of the draw that carried it. */
  t: number;
  asOf: string;
  /** Parallel to `bands`. */
  values: number[];
  total: number;
}

export function renderPool(container: HTMLElement, options: PoolOptions): () => void {
  const draw = () => paint(container, options);
  draw();

  let frame = 0;
  const observer = new ResizeObserver(() => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(draw);
  });
  observer.observe(container);

  return () => {
    cancelAnimationFrame(frame);
    observer.disconnect();
  };
}

/**
 * Distinct pool observations, oldest first.
 *
 * IRCC measures the pool periodically and then republishes that same
 * distribution alongside every draw until the next measurement — four draws in a
 * week can all carry the figures from one Sunday. Keying on `poolAsOf` collapses
 * those back to the single observation they actually are, so the chart doesn't
 * plot one measurement as four points and the table doesn't repeat it.
 */
export function poolSnapshots(rounds: Round[], bands: Band[]): Snapshot[] {
  const snapshots: Snapshot[] = [];
  const seen = new Set<string>();

  for (const round of rounds) {
    const values = bands.map((b) => round.pool.bands[b.label]);
    if (values.some((v) => v === null || v === undefined)) continue;
    const clean = values as number[];
    const total = clean.reduce((a, b) => a + b, 0);
    if (total <= 0) continue;

    // Fall back to the draw date for the older rounds that carry no `poolAsOf`.
    const measured = round.poolAsOf ? Date.parse(round.poolAsOf) : Number.NaN;
    const t = Number.isNaN(measured) ? Date.parse(round.date) : measured;
    if (Number.isNaN(t)) continue;

    const key = String(t);
    if (seen.has(key)) continue;
    seen.add(key);

    snapshots.push({
      round, t, values: clean, total,
      asOf: new Date(t).toISOString().slice(0, 10),
    });
  }

  return snapshots.sort((a, b) => a.t - b.t);
}

function paint(container: HTMLElement, { rounds, bands, mode }: PoolOptions) {
  container.replaceChildren();

  const snapshots = poolSnapshots(rounds, bands);
  if (snapshots.length < 2) {
    container.append(Object.assign(document.createElement('p'), {
      className: 'empty',
      textContent: 'Not enough pool snapshots in this period to plot a composition.',
    }));
    return;
  }

  const width = Math.max(container.clientWidth || 640, 280);
  const compact = width < COMPACT_WIDTH;
  const height = compact ? HEIGHT_COMPACT : HEIGHT;
  const plotW = width - MARGIN.left - MARGIN.right;
  const plotH = height - MARGIN.top - MARGIN.bottom;

  const t0 = snapshots[0]!.t;
  const t1 = snapshots[snapshots.length - 1]!.t;
  const tSpan = t1 - t0 || 86_400_000 * 30;

  const share = mode === 'share';
  const yMax = share ? 100 : Math.max(...snapshots.map((s) => s.total));
  const yTicks = share ? [0, 25, 50, 75, 100] : niceTicks(0, yMax, compact ? 4 : 5);

  const xOf = (t: number) => MARGIN.left + ((t - t0) / tSpan) * plotW;
  const yOf = (v: number) => MARGIN.top + plotH - (v / yMax) * plotH;

  /** Cumulative tops per snapshot, bottom band first. */
  const stacked = snapshots.map((s) => {
    const scale = share ? 100 / s.total : 1;
    let running = 0;
    return s.values.map((v) => {
      running += v * scale;
      return running;
    });
  });

  const svg = svgEl('svg', {
    width, height,
    class: 'chart',
    role: 'img',
    'aria-label': `Composition of the Express Entry pool across ${bands.length} CRS bands over ${snapshots.length} draws, shown as ${share ? 'share of pool' : 'candidate counts'}. Full values in the table below.`,
  });

  for (const tick of yTicks) {
    svg.append(svgEl('line', {
      x1: MARGIN.left, x2: MARGIN.left + plotW,
      y1: yOf(tick), y2: yOf(tick),
      class: 'chart__grid',
    }));
    svg.append(text(
      share ? `${tick}%` : compactInt(tick),
      MARGIN.left - 8, yOf(tick) + 3,
      'chart__tick chart__tick--y',
    ));
  }

  for (const tick of timeTicks(t0, t1, compact ? 4 : 8)) {
    if (tick.t < t0 || tick.t > t1) continue;
    svg.append(text(tick.label, xOf(tick.t), MARGIN.top + plotH + 18, 'chart__tick'));
  }

  // ── stacked areas, bottom band first ────────────────────────────────────────
  bands.forEach((_band, i) => {
    const top: string[] = [];
    const bottom: string[] = [];
    snapshots.forEach((s, j) => {
      const x = xOf(s.t);
      top.push(`${x},${yOf(stacked[j]![i]!)}`);
      bottom.push(`${x},${yOf(i === 0 ? 0 : stacked[j]![i - 1]!)}`);
    });
    svg.append(svgEl('path', {
      d: `M${top.join('L')}L${bottom.reverse().join('L')}Z`,
      class: `pool-band pool-band--${i + 1}`,
    }));
  });

  // Separators in the surface colour do the job a stroke around each area would
  // do badly — the boundary reads as a gap, not as extra data-weight ink.
  bands.forEach((_band, i) => {
    if (i === bands.length - 1) return;
    svg.append(svgEl('polyline', {
      points: snapshots.map((s, j) => `${xOf(s.t)},${yOf(stacked[j]![i]!)}`).join(' '),
      class: 'pool-sep',
    }));
  });

  svg.append(svgEl('line', {
    x1: MARGIN.left, x2: MARGIN.left + plotW,
    y1: MARGIN.top + plotH, y2: MARGIN.top + plotH,
    class: 'chart__axis',
  }));

  const crosshair = svgEl('line', {
    y1: MARGIN.top, y2: MARGIN.top + plotH,
    class: 'chart__crosshair', visibility: 'hidden',
  });
  svg.append(crosshair);
  container.append(svg);

  const tooltip = document.createElement('div');
  tooltip.className = 'chart__tooltip';
  tooltip.hidden = true;
  container.append(tooltip);

  // One tooltip lists every band at that date, so the pointer never has to land
  // on a particular sliver to read it.
  let active = -1;
  const show = (index: number) => {
    const s = snapshots[index];
    if (!s) return;
    active = index;

    const x = xOf(s.t);
    crosshair.setAttribute('x1', String(x));
    crosshair.setAttribute('x2', String(x));
    crosshair.setAttribute('visibility', 'visible');

    const rows: HTMLElement[] = [
      node('div', 'chart__tooltip-value', int(s.total)),
      node('div', 'chart__tooltip-label', 'candidates in pool'),
      node('div', 'chart__tooltip-meta', `pool as of ${stampDate(s.asOf)}`),
    ];
    // Highest band first, matching the stack's visual order top-to-bottom.
    for (let i = bands.length - 1; i >= 0; i--) {
      const value = s.values[i]!;
      const row = node('div', 'pool-row', '');
      row.append(
        node('span', `pool-row__key pool-row__key--${i + 1}`, ''),
        node('span', 'pool-row__band', bands[i]!.label),
        node(
          'span',
          'pool-row__value',
          share ? `${((value / s.total) * 100).toFixed(1)}%` : int(value),
        ),
      );
      rows.push(row);
    }
    tooltip.replaceChildren(...rows);
    tooltip.hidden = false;

    const flip = x > MARGIN.left + plotW - 190;
    tooltip.style.left = `${flip ? x - 12 : x + 12}px`;
    tooltip.style.transform = flip ? 'translateX(-100%)' : 'none';
    tooltip.style.top = `${MARGIN.top}px`;
  };

  const hide = () => {
    active = -1;
    crosshair.setAttribute('visibility', 'hidden');
    tooltip.hidden = true;
  };

  const nearest = (clientX: number) => {
    const rect = svg.getBoundingClientRect();
    const x = clientX - rect.left;
    let best = 0;
    let bestDist = Infinity;
    snapshots.forEach((s, i) => {
      const d = Math.abs(xOf(s.t) - x);
      if (d < bestDist) { bestDist = d; best = i; }
    });
    return best;
  };

  svg.addEventListener('pointermove', (e) => show(nearest(e.clientX)));
  svg.addEventListener('pointerleave', hide);

  svg.setAttribute('tabindex', '0');
  svg.addEventListener('focus', () => show(active === -1 ? snapshots.length - 1 : active));
  svg.addEventListener('blur', hide);
  svg.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const step = e.key === 'ArrowLeft' ? -1 : 1;
    const start = active === -1 ? snapshots.length - 1 : active;
    show(Math.min(snapshots.length - 1, Math.max(0, start + step)));
  });
}

function timeTicks(t0: number, t1: number, target: number): { t: number; label: string }[] {
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const spanDays = (t1 - t0) / 86_400_000;
  const ticks: { t: number; label: string }[] = [];

  if (spanDays > 900) {
    const first = new Date(t0).getUTCFullYear();
    const last = new Date(t1).getUTCFullYear();
    const years: number[] = [];
    for (let y = first; y <= last; y++) years.push(y);
    const stride = Math.max(1, Math.ceil(years.length / target));
    years.forEach((y, i) => {
      if (i % stride === 0) ticks.push({ t: Date.UTC(y, 0, 1), label: String(y) });
    });
    return ticks;
  }

  const start = new Date(t0);
  const cursor = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1);
  const monthCount = Math.max(1, Math.round(spanDays / 30.44));
  const stride = Math.max(1, Math.ceil(monthCount / target));
  for (let i = 0; ; i += stride) {
    const d = new Date(cursor);
    const t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + i, 1);
    if (t > t1) break;
    ticks.push({ t, label: months[new Date(t).getUTCMonth()] ?? '' });
  }
  return ticks;
}

function text(content: string, x: number, y: number, className: string) {
  const node = svgEl('text', { x, y, class: className });
  node.textContent = content;
  return node;
}

function node(tag: string, className: string, content: string) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (content) element.textContent = content;
  return element;
}
