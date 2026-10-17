import { int } from '../format';
import { niceTicks, svgEl } from './svg';

/**
 * Reachable candidates by CRS score, today and with the high-wage bonus applied —
 * paired bars per 5-point bin, with the two cutoffs as dashed thresholds.
 *
 * Two series, so it carries a legend (drawn by the caller) and both cutoffs are
 * direct-labelled. Dashes are used only for the thresholds, never the grid.
 */

const MARGIN = { top: 22, right: 12, bottom: 30, left: 46 };
const HEIGHT = 280;
const HEIGHT_COMPACT = 220;
const COMPACT_WIDTH = 620;
const BIN = 5;
const LO = 430;
const HI = 640;

export interface ShiftOptions {
  today: Float64Array;
  shifted: Float64Array;
  reach: number;
  before: number;
  after: number;
}

interface Bin {
  from: number;
  today: number;
  shifted: number;
}

export function renderShift(container: HTMLElement, options: ShiftOptions): () => void {
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

function paint(container: HTMLElement, { today, shifted, reach, before, after }: ShiftOptions) {
  container.replaceChildren();

  const bins: Bin[] = [];
  for (let from = LO; from < HI; from += BIN) {
    let a = 0;
    let b = 0;
    for (let s = from; s < from + BIN; s++) {
      a += (today[s] ?? 0) * reach;
      b += (shifted[s] ?? 0) * reach;
    }
    bins.push({ from, today: a, shifted: b });
  }

  const width = Math.max(container.clientWidth || 640, 280);
  const compact = width < COMPACT_WIDTH;
  const height = compact ? HEIGHT_COMPACT : HEIGHT;
  const plotW = width - MARGIN.left - MARGIN.right;
  const plotH = height - MARGIN.top - MARGIN.bottom;

  const peak = Math.max(...bins.map((b) => Math.max(b.today, b.shifted)), 1);
  const yTicks = niceTicks(0, peak, compact ? 3 : 4);
  const yMax = Math.max(peak, yTicks[yTicks.length - 1] ?? peak);

  const xOf = (score: number) => MARGIN.left + ((score - LO) / (HI - LO)) * plotW;
  const yOf = (v: number) => MARGIN.top + plotH - (v / yMax) * plotH;
  const slot = plotW / bins.length;
  // Two bars and a 2px gap per bin, with a little air between bins.
  const barW = Math.max(1, (slot - 2) / 2 - 1);

  const svg = svgEl('svg', {
    width, height,
    class: 'chart',
    role: 'img',
    'aria-label': `Reachable candidates by CRS score in 5-point bins, today and with high-wage points. The cutoff moves from ${before} to ${after}.`,
  });

  for (const tick of yTicks) {
    svg.append(svgEl('line', {
      x1: MARGIN.left, x2: MARGIN.left + plotW, y1: yOf(tick), y2: yOf(tick), class: 'chart__grid',
    }));
    svg.append(text(int(tick), MARGIN.left - 8, yOf(tick) + 3, 'chart__tick chart__tick--y'));
  }
  for (let s = LO; s <= HI; s += compact ? 40 : 20) {
    svg.append(text(String(s), xOf(s), MARGIN.top + plotH + 18, 'chart__tick'));
  }

  const marks = svgEl('g', {});
  bins.forEach((b, i) => {
    const x0 = MARGIN.left + i * slot + 1;
    marks.append(bar(x0, barW, yOf(b.today), yOf(0), 'shift-bar shift-bar--today'));
    marks.append(bar(x0 + barW + 2, barW, yOf(b.shifted), yOf(0), 'shift-bar shift-bar--after'));
  });
  svg.append(marks);

  svg.append(svgEl('line', {
    x1: MARGIN.left, x2: MARGIN.left + plotW, y1: MARGIN.top + plotH, y2: MARGIN.top + plotH, class: 'chart__axis',
  }));

  // "before" reads leftward from its line and "after" rightward from its own, so
  // two cutoffs a few points apart never print on top of each other.
  for (const [score, label, side] of [[before, `today ${before}`, 'end'], [after, `after ${after}`, 'start']] as const) {
    if (score < LO || score > HI) continue;
    const x = xOf(score);
    svg.append(svgEl('line', { x1: x, x2: x, y1: MARGIN.top - 6, y2: MARGIN.top + plotH, class: 'shift-cutoff' }));
    // A class, not the text-anchor attribute: `.chart__tick` centres text in CSS,
    // and CSS beats SVG presentation attributes, which left the labels colliding.
    svg.append(text(label, x + (side === 'end' ? -4 : 4), MARGIN.top - 10, `chart__tick shift-cutoff__label shift-cutoff__label--${side}`));
  }

  const highlight = svgEl('rect', {
    y: MARGIN.top, height: plotH, width: slot, class: 'shift-hover', visibility: 'hidden',
  });
  svg.insertBefore(highlight, marks);
  container.append(svg);

  const tooltip = document.createElement('div');
  tooltip.className = 'chart__tooltip';
  tooltip.hidden = true;
  container.append(tooltip);

  let active = -1;
  const show = (index: number) => {
    const b = bins[index];
    if (!b) return;
    active = index;
    const x = MARGIN.left + index * slot;
    highlight.setAttribute('x', String(x));
    highlight.setAttribute('visibility', 'visible');

    tooltip.replaceChildren(
      node('div', 'chart__tooltip-value', `CRS ${b.from}–${b.from + BIN - 1}`),
      row('shift-key shift-key--today', 'Today', int(Math.round(b.today))),
      row('shift-key shift-key--after', 'With points', int(Math.round(b.shifted))),
      node('div', 'chart__tooltip-meta', 'reachable candidates'),
    );
    tooltip.hidden = false;
    const flip = x > MARGIN.left + plotW - 170;
    tooltip.style.left = `${flip ? x - 8 : x + slot + 8}px`;
    tooltip.style.transform = flip ? 'translateX(-100%)' : 'none';
    tooltip.style.top = `${MARGIN.top}px`;
  };

  const hide = () => {
    active = -1;
    highlight.setAttribute('visibility', 'hidden');
    tooltip.hidden = true;
  };

  const indexAt = (clientX: number) => {
    const x = clientX - svg.getBoundingClientRect().left - MARGIN.left;
    return Math.min(bins.length - 1, Math.max(0, Math.floor(x / slot)));
  };

  svg.addEventListener('pointermove', (e) => show(indexAt(e.clientX)));
  svg.addEventListener('pointerleave', hide);
  svg.setAttribute('tabindex', '0');
  const start = () => Math.max(0, bins.findIndex((b) => b.from + BIN > after));
  svg.addEventListener('focus', () => show(active === -1 ? start() : active));
  svg.addEventListener('blur', hide);
  svg.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const from = active === -1 ? start() : active;
    show(Math.min(bins.length - 1, Math.max(0, from + (e.key === 'ArrowLeft' ? -1 : 1))));
  });
}

/** A bar with a 2px-rounded data end and a square foot on the baseline. */
function bar(x: number, w: number, top: number, base: number, className: string) {
  const h = base - top;
  if (h <= 0.5) return svgEl('g', {});
  const r = Math.min(2, w / 2, h);
  return svgEl('path', {
    d: `M${x},${base}V${top + r}Q${x},${top} ${x + r},${top}H${x + w - r}Q${x + w},${top} ${x + w},${top + r}V${base}Z`,
    class: className,
  });
}

function row(keyClass: string, label: string, value: string) {
  const r = node('div', 'pool-row', '');
  r.append(node('span', `pool-row__key ${keyClass}`, ''), node('span', 'pool-row__band', label), node('span', 'pool-row__value', value));
  return r;
}

function text(content: string, x: number, y: number, className: string) {
  const t = svgEl('text', { x, y, class: className });
  t.textContent = content;
  return t;
}

function node(tag: string, className: string, content: string) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (content) element.textContent = content;
  return element;
}
