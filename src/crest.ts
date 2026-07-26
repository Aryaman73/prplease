import { svgEl } from './chart/svg';

/**
 * The ministry's crest: a maple leaf between two folded wings, on a plinth.
 *
 * Drawn cell by cell rather than as a vector outline. The whole interface is set
 * in a bitmap face with font-smoothing switched off, and a smooth-edged mark
 * beside it reads as a logo pasted in from a different project. Every cell here
 * is a whole pixel, so the crest ages exactly the way the type does.
 *
 * Edit it as the picture it is — the rows below are the artwork, not data.
 */
const SPRITE = [
  '..........#..........',
  '.........###.........',
  '####.....###.....####',
  '####..#..###..#..####',
  '.###..#########..###.',
  '.###...#######...###.',
  '..##.#.#######.#.##..',
  '...#.###########.#...',
  '.......#######.......',
  '........#####........',
  '..........#..........',
  '..........#..........',
  '...###############...',
];

/** Every row is the same width by construction; the sprite is a rectangle. */
const COLS = 21;
const ROWS = SPRITE.length;

/**
 * `cell` is the size of one artwork pixel, in CSS pixels, and must stay a whole
 * number: a fractional cell puts the mark's edges between device pixels, and
 * `shape-rendering: crispEdges` then rounds them independently, which shows up
 * as one wing a row thicker than the other.
 */
export function crest(cell = 3, className = 'crest'): SVGSVGElement {
  const svg = svgEl('svg', {
    class: className,
    viewBox: `0 0 ${COLS} ${ROWS}`,
    width: COLS * cell,
    height: ROWS * cell,
    // Ornament. The masthead's own heading carries the name.
    'aria-hidden': 'true',
    focusable: 'false',
  });

  // One rect per horizontal run of cells rather than one per cell: the same
  // picture out of roughly a fifth of the nodes.
  SPRITE.forEach((row, y) => {
    let x = 0;
    while (x < COLS) {
      if (row[x] !== '#') {
        x++;
        continue;
      }
      let end = x;
      while (end < COLS && row[end] === '#') end++;
      svg.append(svgEl('rect', { x, y, width: end - x, height: 1 }));
      x = end;
    }
  });

  return svg;
}
