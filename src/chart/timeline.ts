import { int, stampDate } from '../format';
import type { Round } from '../types';
import { niceTicks, svgEl } from './svg';

/**
 * CRS cut-off over time.
 *
 * Plots exactly the rounds it is given — one series, one colour. Scoping is the
 * caller's job, which is what lets the y-axis fit the selected category: mixing
 * PNP (cut-offs in the 700-800s) with CEC (low 500s) flattens CEC into a sliver.
 *
 * A connecting line is drawn only when the set is a single category. Joining
 * draws across categories would imply a continuity that isn't in the data.
 */

interface Point {
  round: Round;
  t: number;
  crs: number;
  x: number;
  y: number;
}

/**
 * A category is treated as dormant — and its line broken — after six months with
 * no draw. Active categories draw every few weeks, so this only ever splits real
 * pauses in the programme, never normal spacing.
 */
const DORMANT_MS = 180 * 86_400_000;

const MARGIN = { top: 14, right: 14, bottom: 30, left: 46 };
const HEIGHT = 300;
const HEIGHT_COMPACT = 220;
const COMPACT_WIDTH = 620;

export interface TimelineOptions {
  /** Exactly the rounds to plot; already scoped by the caller. */
  rounds: Round[];
  /** True when every round is the same category, so a trend line is meaningful. */
  connect: boolean;
  label: string | null;
}

export function renderTimeline(container: HTMLElement, options: TimelineOptions): () => void {
  const draw = () => paint(container, options);
  draw();

  // Re-render on width change; the SVG is drawn at real pixel size rather than
  // scaled by a viewBox, so bitmap axis labels stay crisp at every breakpoint.
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

function paint(container: HTMLElement, { rounds, connect, label }: TimelineOptions) {
  container.replaceChildren();

  const usable = rounds.filter((r) => r.crsCutoff !== null && !Number.isNaN(Date.parse(r.date)));
  if (usable.length === 0) {
    container.append(Object.assign(document.createElement('p'), {
      className: 'empty',
      textContent: 'No draws match the current filter.',
    }));
    return;
  }

  const width = Math.max(container.clientWidth || 640, 280);
  const compact = width < COMPACT_WIDTH;
  const height = compact ? HEIGHT_COMPACT : HEIGHT;
  const plotW = width - MARGIN.left - MARGIN.right;
  const plotH = height - MARGIN.top - MARGIN.bottom;

  const sorted = [...usable].sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  const times = sorted.map((r) => Date.parse(r.date));
  const scores = sorted.map((r) => r.crsCutoff as number);

  const t0 = Math.min(...times);
  const t1 = Math.max(...times);
  // Pad a single-draw domain so the point doesn't sit on the axis.
  const tSpan = t1 - t0 || 86_400_000 * 30;

  // Pad the domain so the extreme marks don't sit on the axis or the ceiling.
  const dataMin = Math.min(...scores);
  const dataMax = Math.max(...scores);
  const pad = (dataMax - dataMin || 10) * 0.12;
  const yTicks = niceTicks(dataMin, dataMax, compact ? 4 : 5);
  const yMin = Math.min(dataMin - pad, ...yTicks);
  const yMax = Math.max(dataMax + pad, ...yTicks);
  const ySpan = yMax - yMin || 1;

  const xOf = (t: number) => MARGIN.left + ((t - t0) / tSpan) * plotW;
  const yOf = (v: number) => MARGIN.top + plotH - ((v - yMin) / ySpan) * plotH;

  const points: Point[] = sorted.map((round) => {
    const t = Date.parse(round.date);
    const crs = round.crsCutoff as number;
    return { round, t, crs, x: xOf(t), y: yOf(crs) };
  });

  const svg = svgEl('svg', {
    width, height,
    class: 'chart',
    role: 'img',
    'aria-label': `CRS cut-off for ${points.length} ${label ?? 'rounds of invitations'} over time, ranging from ${Math.min(...scores)} to ${Math.max(...scores)}. Full values in the table below.`,
  });

  // ── grid: solid hairlines, one step off the paper, behind everything ────────
  for (const tick of yTicks) {
    svg.append(svgEl('line', {
      x1: MARGIN.left, x2: MARGIN.left + plotW,
      y1: yOf(tick), y2: yOf(tick),
      class: 'chart__grid',
    }));
    svg.append(text(String(tick), MARGIN.left - 8, yOf(tick) + 3, 'chart__tick chart__tick--y'));
  }

  // ── x axis ──────────────────────────────────────────────────────────────────
  for (const tick of timeTicks(t0, t1, compact ? 4 : 8)) {
    if (tick.t < t0 || tick.t > t1) continue;
    svg.append(text(tick.label, xOf(tick.t), MARGIN.top + plotH + 18, 'chart__tick'));
  }

  svg.append(svgEl('line', {
    x1: MARGIN.left, x2: MARGIN.left + plotW,
    y1: MARGIN.top + plotH, y2: MARGIN.top + plotH,
    class: 'chart__axis',
  }));

  // ── line ────────────────────────────────────────────────────────────────────
  // Broken wherever the category went dormant: CEC ran in 2015, paused for
  // years, then resumed, and one unbroken segment draws a confident trend
  // straight through a period containing no draws at all.
  if (connect && points.length > 1) {
    for (const segment of segmentByGap(points, DORMANT_MS)) {
      if (segment.length < 2) continue;
      svg.append(svgEl('polyline', {
        points: segment.map((p) => `${p.x},${p.y}`).join(' '),
        class: 'chart__line',
      }));
    }
  }

  // ── marks ───────────────────────────────────────────────────────────────────
  // Squares, not circles: they render crisp at small sizes and match the bitmap
  // register. They shrink where draws bunch up — at full size dense clusters
  // merge into a solid bar that reads as a thick line rather than as rounds.
  const spacing = medianSpacing(points);
  const dense = spacing < 10;
  const markSize = !connect ? 4 : dense ? 3 : 6;
  const ringPad = connect && !dense ? 2 : 0;

  const marks = svgEl('g', { class: 'chart__marks' });
  for (const p of points) {
    // A ring in the surface colour keeps overlapping marks legible; drawn as a
    // slightly larger backing square rather than a stroke on the mark itself.
    if (ringPad > 0) {
      marks.append(svgEl('rect', {
        x: p.x - markSize / 2 - ringPad, y: p.y - markSize / 2 - ringPad,
        width: markSize + ringPad * 2, height: markSize + ringPad * 2,
        class: 'chart__ring', 'shape-rendering': 'crispEdges',
      }));
    }
    marks.append(svgEl('rect', {
      x: p.x - markSize / 2, y: p.y - markSize / 2,
      width: markSize, height: markSize,
      'shape-rendering': 'crispEdges',
    }));
  }
  svg.append(marks);

  // ── hover layer ─────────────────────────────────────────────────────────────
  const crosshair = svgEl('line', {
    y1: MARGIN.top, y2: MARGIN.top + plotH,
    class: 'chart__crosshair', visibility: 'hidden',
  });
  const highlight = svgEl('rect', {
    width: 11, height: 11, class: 'chart__highlight',
    visibility: 'hidden', 'shape-rendering': 'crispEdges',
  });
  svg.append(crosshair, highlight);

  container.append(svg);

  const tooltip = document.createElement('div');
  tooltip.className = 'chart__tooltip';
  tooltip.hidden = true;
  container.append(tooltip);

  // Nearest-point-by-x: the reader aims at a date, never at a 3px mark.
  let active = -1;
  const show = (index: number) => {
    const p = points[index];
    if (!p) return;
    active = index;

    crosshair.setAttribute('x1', String(p.x));
    crosshair.setAttribute('x2', String(p.x));
    crosshair.setAttribute('visibility', 'visible');
    highlight.setAttribute('x', String(p.x - 5.5));
    highlight.setAttribute('y', String(p.y - 5.5));
    highlight.setAttribute('visibility', 'visible');

    // Untrusted upstream strings: build with textContent, never innerHTML.
    tooltip.replaceChildren(
      node('div', 'chart__tooltip-value', int(p.crs)),
      node('div', 'chart__tooltip-label', p.round.categoryLabel),
      node('div', 'chart__tooltip-meta', `No. ${p.round.number} · ${stampDate(p.round.date)}`),
      node('div', 'chart__tooltip-meta', `${int(p.round.invitations)} invitations`),
    );
    tooltip.hidden = false;

    // Flip the tooltip to the other side of the crosshair near the right edge.
    const flip = p.x > MARGIN.left + plotW - 130;
    tooltip.style.left = `${flip ? p.x - 12 : p.x + 12}px`;
    tooltip.style.transform = flip ? 'translateX(-100%)' : 'none';
    tooltip.style.top = `${Math.max(MARGIN.top, p.y - 40)}px`;
  };

  const hide = () => {
    active = -1;
    crosshair.setAttribute('visibility', 'hidden');
    highlight.setAttribute('visibility', 'hidden');
    tooltip.hidden = true;
  };

  const nearest = (clientX: number) => {
    const rect = svg.getBoundingClientRect();
    const x = clientX - rect.left;
    let best = 0;
    let bestDist = Infinity;
    points.forEach((p, i) => {
      const d = Math.abs(p.x - x);
      if (d < bestDist) { bestDist = d; best = i; }
    });
    return best;
  };

  svg.addEventListener('pointermove', (e) => show(nearest(e.clientX)));
  svg.addEventListener('pointerleave', hide);

  // Keyboard parity: same readout, stepped rather than pointed at.
  svg.setAttribute('tabindex', '0');
  svg.addEventListener('focus', () => show(active === -1 ? points.length - 1 : active));
  svg.addEventListener('blur', hide);
  svg.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const step = e.key === 'ArrowLeft' ? -1 : 1;
    const start = active === -1 ? points.length - 1 : active;
    show(Math.min(points.length - 1, Math.max(0, start + step)));
  });
}

/**
 * Axis ticks that suit the span: years across a decade, months across a year or
 * two. A one-year window labelled only "2026" tells the reader nothing.
 */
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

/** Split a time-ordered run of points wherever the gap exceeds `maxGap`. */
function segmentByGap(points: Point[], maxGap: number): Point[][] {
  const segments: Point[][] = [];
  let current: Point[] = [];
  for (const p of points) {
    const previous = current[current.length - 1];
    if (previous && p.t - previous.t > maxGap) {
      segments.push(current);
      current = [];
    }
    current.push(p);
  }
  if (current.length > 0) segments.push(current);
  return segments;
}

function medianSpacing(points: Point[]): number {
  if (points.length < 2) return Infinity;
  const gaps: number[] = [];
  for (let i = 1; i < points.length; i++) {
    gaps.push((points[i]?.x ?? 0) - (points[i - 1]?.x ?? 0));
  }
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)] ?? Infinity;
}

function text(content: string, x: number, y: number, className: string) {
  const node = svgEl('text', { x, y, class: className });
  node.textContent = content;
  return node;
}

function node(tag: string, className: string, content: string) {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = content;
  return element;
}
