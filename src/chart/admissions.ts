import { compactInt, int } from '../format';
import type { AdmissionsKey, AdmissionsYear, PlanFigure } from '../types';
import { niceTicks, svgEl } from './svg';

/**
 * Permanent residents admitted per year against the levels plan.
 *
 * One measure on one axis: people. Each year is a column of actual admissions,
 * with the plan's target as a tick across it and the plan's range as a faint
 * band behind it. Earlier plans' figures for the same year sit on the column as
 * open rings — the goalposts as they were before they moved.
 *
 * Column colour says how the year landed against the plan: blue at or under
 * target and inside the range, orange over target but still inside the range,
 * red outside the range in either direction. The year in progress is judged
 * only on what it has already passed — over the full-year target or above the
 * range's top — never on a shortfall that the remaining months could close.
 *
 * The year in progress is hatched rather than solid: it is a real count, but of
 * fewer than twelve months. Future years carry targets only. A plan's out-year
 * targets are notional, but they are drawn exactly like current ones; the
 * tooltip and ledger say which plan set each.
 */

const MARGIN = { top: 18, right: 10, bottom: 30, left: 46 };
const HEIGHT = 320;
const HEIGHT_COMPACT = 250;
const COMPACT_WIDTH = 620;
const BAR_MAX = 24;
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

export interface AdmissionsChartOptions {
  years: AdmissionsYear[];
  category: AdmissionsKey;
  categoryLabel: string;
}

export const planLabel = (key: string) => key.replace('-', '–');

export function monthsLabel(months: number): string {
  return months >= 12 ? 'full year' : `JAN–${MONTHS[months - 1] ?? ''}`;
}

export function renderAdmissionsChart(container: HTMLElement, options: AdmissionsChartOptions): () => void {
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

const figure = (y: AdmissionsYear, key: AdmissionsKey): PlanFigure | null => y.target?.values[key] ?? null;

function paint(container: HTMLElement, { years, category, categoryLabel }: AdmissionsChartOptions) {
  container.replaceChildren();

  const width = Math.max(container.clientWidth || 640, 280);
  const compact = width < COMPACT_WIDTH;
  const height = compact ? HEIGHT_COMPACT : HEIGHT;
  const plotW = width - MARGIN.left - MARGIN.right;
  const plotH = height - MARGIN.top - MARGIN.bottom;

  const peak = Math.max(1, ...years.flatMap((y) => {
    const f = figure(y, category);
    return [
      y.actual?.[category] ?? 0,
      f?.target ?? 0,
      f?.high ?? 0,
      ...y.versions.map((v) => v.values[category]?.target ?? 0),
    ];
  }));
  // Round the top up to the next tick, so the highest range or ring is labelled
  // against a gridline rather than floating above the last one.
  const yTicks = niceTicks(0, peak, compact ? 4 : 5);
  const step = (yTicks[1] ?? peak) - (yTicks[0] ?? 0);
  if ((yTicks[yTicks.length - 1] ?? 0) < peak) yTicks.push((yTicks[yTicks.length - 1] ?? 0) + step);
  const yMax = yTicks[yTicks.length - 1] ?? peak;

  const slot = plotW / years.length;
  const barW = Math.min(BAR_MAX, Math.max(4, slot * 0.55));
  const tickHalf = Math.min(slot * 0.42, barW / 2 + 7);
  const cx = (i: number) => MARGIN.left + slot * (i + 0.5);
  const yOf = (v: number) => MARGIN.top + plotH - (v / yMax) * plotH;

  const svg = svgEl('svg', {
    width, height,
    class: 'chart',
    role: 'img',
    'aria-label': `${categoryLabel}: permanent residents admitted each year from ${years[0]?.year} against the immigration levels plan target, through ${years[years.length - 1]?.year}. Full values in the table below.`,
  });

  // Hatching for the partial year, at 45° on paper — one per column colour.
  const defs = svgEl('defs', {});
  for (const tone of ['within', 'over', 'outside'] as const) {
    const [id, ink] = [`adm-hatch-${tone}`, `adm-hatch__ink adm-hatch__ink--${tone}`];
    const pattern = svgEl('pattern', {
      id: id!, width: 5, height: 5, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)',
    });
    pattern.append(svgEl('rect', { width: 5, height: 5, class: 'adm-hatch__ground' }));
    pattern.append(svgEl('rect', { width: 2.5, height: 5, class: ink! }));
    defs.append(pattern);
  }
  svg.append(defs);

  for (const tick of yTicks) {
    svg.append(svgEl('line', {
      x1: MARGIN.left, x2: MARGIN.left + plotW, y1: yOf(tick), y2: yOf(tick), class: 'chart__grid',
    }));
    svg.append(text(compactInt(tick), MARGIN.left - 8, yOf(tick) + 3, 'chart__tick chart__tick--y'));
  }

  // Year labels thin out until they stop colliding (~34px per "2026").
  const stride = Math.max(1, Math.ceil(34 / slot));
  const last = years.length - 1;
  years.forEach((y, i) => {
    if ((last - i) % stride !== 0) return;
    svg.append(text(String(y.year), cx(i), MARGIN.top + plotH + 18, 'chart__tick'));
  });

  const highlight = svgEl('rect', {
    y: MARGIN.top, height: plotH, width: slot, class: 'shift-hover', visibility: 'hidden',
  });
  svg.append(highlight);

  const marks = svgEl('g', {});
  years.forEach((y, i) => {
    const x = cx(i);
    const f = figure(y, category);

    if (f?.low != null && f.high != null) {
      marks.append(svgEl('rect', {
        x: x - tickHalf, width: tickHalf * 2,
        y: yOf(f.high), height: Math.max(1, yOf(f.low) - yOf(f.high)),
        class: 'adm-range',
      }));
    }

    const actual = y.actual?.[category];
    if (actual != null && y.monthsReported > 0) {
      const partial = y.monthsReported < 12;
      const tone = TONE[standingOf(y, category) ?? 'within'];
      marks.append(column(x - barW / 2, barW, yOf(actual), yOf(0), `adm-bar adm-bar--${tone}${partial ? ' adm-bar--partial' : ''}`));
      if (partial && !compact) {
        svg.append(text(monthsLabel(y.monthsReported), x, yOf(actual) - 6, 'chart__tick adm-partial-label'));
      }
    }
  });
  svg.append(marks);

  svg.append(svgEl('line', {
    x1: MARGIN.left, x2: MARGIN.left + plotW, y1: MARGIN.top + plotH, y2: MARGIN.top + plotH, class: 'chart__axis',
  }));

  // Targets sit over the columns so a column that reaches its target still shows it.
  const overlay = svgEl('g', {});
  years.forEach((y, i) => {
    const x = cx(i);
    for (const v of y.versions) {
      const t = v.values[category]?.target;
      if (!t || v.plan === y.target?.plan) continue;
      overlay.append(svgEl('circle', { cx: x, cy: yOf(t), r: 4, class: 'adm-earlier' }));
    }
    const t = figure(y, category)?.target;
    if (t) {
      overlay.append(svgEl('line', {
        x1: x - tickHalf, x2: x + tickHalf, y1: yOf(t), y2: yOf(t),
        class: 'adm-target',
      }));
    }
  });
  svg.append(overlay);
  container.append(svg);

  const tooltip = document.createElement('div');
  tooltip.className = 'chart__tooltip adm-tooltip';
  tooltip.hidden = true;
  container.append(tooltip);

  let active = -1;
  const show = (index: number) => {
    const y = years[index];
    if (!y) return;
    active = index;
    const x0 = MARGIN.left + index * slot;
    highlight.setAttribute('x', String(x0));
    highlight.setAttribute('visibility', 'visible');

    tooltip.replaceChildren(...tooltipRows(y, category));
    tooltip.hidden = false;
    const flip = x0 > MARGIN.left + plotW - 220;
    tooltip.style.left = `${flip ? x0 - 8 : x0 + slot + 8}px`;
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
    return Math.min(years.length - 1, Math.max(0, Math.floor(x / slot)));
  };

  // Focus starts on the most recent year with an actual count.
  const latest = () => {
    for (let i = years.length - 1; i >= 0; i--) if (years[i]!.monthsReported > 0) return i;
    return years.length - 1;
  };

  svg.addEventListener('pointermove', (e) => show(indexAt(e.clientX)));
  svg.addEventListener('pointerleave', hide);
  svg.setAttribute('tabindex', '0');
  svg.addEventListener('focus', () => show(active === -1 ? latest() : active));
  svg.addEventListener('blur', hide);
  svg.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const from = active === -1 ? latest() : active;
    show(Math.min(years.length - 1, Math.max(0, from + (e.key === 'ArrowLeft' ? -1 : 1))));
  });
}

export type Standing = 'within' | 'over' | 'above' | 'below';

export const STANDING_LABEL: Record<Standing, string> = {
  within: 'Within range', over: 'Over target', above: 'Above range', below: 'Below range',
};

/** Colour group: above and below the range share one. */
const TONE: Record<Standing, 'within' | 'over' | 'outside'> = {
  within: 'within', over: 'over', above: 'outside', below: 'outside',
};

/**
 * How a year landed against its plan, or null with nothing to judge. A year in
 * progress can already be over target or above range, but not yet below range.
 * Where a plan gave a target and no range (Express Entry in 2025–2027), only
 * "over" can be said; with a range and no target (2015), only the range.
 */
export function standingOf(y: AdmissionsYear, key: AdmissionsKey): Standing | null {
  const actual = y.monthsReported > 0 ? y.actual?.[key] : undefined;
  const f = y.target?.values[key];
  if (actual == null || !f) return null;
  const complete = y.monthsReported === 12;
  if (f.high != null && actual > f.high) return 'above';
  if (complete && f.low != null && actual < f.low) return 'below';
  if (f.target != null && actual > f.target) return 'over';
  return f.target != null || complete ? 'within' : null;
}

/**
 * Two figures and one line, no more. Range, plan and earlier plans' figures are
 * all on the chart and in the ledger below; restating them here buried the two
 * numbers anyone hovers for.
 */
function tooltipRows(y: AdmissionsYear, key: AdmissionsKey): HTMLElement[] {
  const target = y.target?.values[key]?.target ?? null;
  const actual = y.monthsReported > 0 ? y.actual?.[key] ?? null : null;
  const partial = y.monthsReported > 0 && y.monthsReported < 12;
  const rows: HTMLElement[] = [node('div', 'chart__tooltip-value', String(y.year))];

  if (actual !== null) rows.push(row(partial ? `Admitted, ${monthsLabel(y.monthsReported).toLowerCase()}` : 'Admitted', int(actual)));
  if (target) rows.push(row('Target', int(target)));

  let meta = '';
  const s = standingOf(y, key);
  if (actual !== null && target) {
    const share = `${((actual / target) * 100).toFixed(0)}% of target`;
    meta = s && s !== 'within' ? `${STANDING_LABEL[s]} · ${share}` : share;
  } else if (s && s !== 'within') {
    meta = STANDING_LABEL[s];
  } else if (!target && actual === null) {
    meta = 'No figure for this category';
  }
  if (meta) rows.push(node('div', 'chart__tooltip-meta', meta));
  return rows;
}

/** A column with a 4px-rounded data end and a square foot on the baseline. */
function column(x: number, w: number, top: number, base: number, className: string) {
  const h = base - top;
  if (h <= 0.5) return svgEl('g', {});
  const r = Math.min(4, w / 2, h);
  return svgEl('path', {
    d: `M${x},${base}V${top + r}Q${x},${top} ${x + r},${top}H${x + w - r}Q${x + w},${top} ${x + w},${top + r}V${base}Z`,
    class: className,
  });
}

function row(label: string, value: string) {
  const r = node('div', 'pool-row', '');
  r.append(node('span', 'pool-row__band', label), node('span', 'pool-row__value', value));
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
