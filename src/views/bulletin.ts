import { el, field } from '../dom';
import { daysAgo, int, stampDate, stampDateTime } from '../format';
import type { Draws, Round } from '../types';

/** A category is only worth checking a score against if it is still being drawn. */
const ACTIVE_WINDOW_DAYS = 550;
const CEC = 'cec';

/**
 * How many recent CEC rounds the CEC-only check covers. One verdict against the
 * latest round is a coin-flip; a run of rounds shows whether a score clears the
 * cut-off consistently or only caught one good week.
 */
const CEC_ROUNDS = 10;

function stamp(text: string, kind: 'approved' | 'denied' | 'flag', land = false) {
  return el('span', {
    class: `stamp stamp--${kind}${land ? ' stamp--land' : ''}`,
    text,
  });
}

/** One round rendered as a document. */
function drawCard(round: Round, bandLeft: string, note?: string) {
  return el(
    'article',
    { class: 'paper' },
    el(
      'div',
      { class: 'paper__band' },
      el('span', { text: bandLeft }),
      el('span', { text: `No. ${round.number}` }),
    ),
    el(
      'div',
      { class: 'paper__body' },
      el('h2', { class: 'paper__title pixel', text: round.categoryLabel }),
      el('p', { class: 'paper__note', text: note ?? round.name }),
      el(
        'div',
        { class: 'figure' },
        el('span', { class: 'figure__value pixel', text: int(round.crsCutoff) }),
        el('span', { class: 'figure__label', text: 'CRS cut-off' }),
      ),
      el(
        'div',
        { class: 'fields' },
        field('Date issued', `${stampDate(round.date)}  (${daysAgo(round.date)})`),
        field('Invitations', int(round.invitations)),
        // Null for rounds where IRCC never published a parseable value; the raw
        // string is kept in the data, but a broken timestamp is not worth showing.
        field(
          'Tie-break',
          round.tieBreak ? stampDateTime(round.tieBreak) : 'Not published',
          !round.tieBreak,
        ),
        field('Pool size', int(round.pool.total)),
        field('Pool as of', round.poolAsOf ?? '—', !round.poolAsOf),
      ),
    ),
  );
}

/**
 * The headline documents: the most recent round overall, and the most recent CEC
 * round. When the latest round *is* a CEC round the two would be identical, so
 * one card is shown and says so rather than printing the same figures twice.
 */
function headline(draws: Draws) {
  const latest = draws.rounds[0];
  if (!latest) {
    return el(
      'article',
      { class: 'paper' },
      el('div', { class: 'paper__body' }, el('p', { class: 'empty', text: 'No rounds on file.' })),
    );
  }

  const latestCec = draws.rounds.find((r) => r.category === CEC);

  if (!latestCec) return drawCard(latest, 'Latest round');

  if (latestCec.number === latest.number) {
    return drawCard(
      latest,
      'Latest round',
      'The most recent round overall, and the most recent Canadian Experience Class round.',
    );
  }

  return el(
    'div',
    { class: 'paper-row' },
    drawCard(latest, 'Latest round'),
    drawCard(latestCec, 'Latest CEC round'),
  );
}

/**
 * Score check: stamp the applicant's CRS against the most recent draw in every
 * active category, or against CEC alone.
 */
function inspection(draws: Draws) {
  const cutoff = Date.now() - ACTIVE_WINDOW_DAYS * 86_400_000;

  // rounds are newest-first, so the first hit per category is the latest one.
  const latestByCategory = new Map<string, Round>();
  for (const round of draws.rounds) {
    if (round.crsCutoff === null) continue;
    if (new Date(`${round.date}T00:00:00Z`).getTime() < cutoff) continue;
    if (!latestByCategory.has(round.category)) latestByCategory.set(round.category, round);
  }

  const all = [...latestByCategory.values()].sort((a, b) => (a.date < b.date ? 1 : -1));

  // The CEC run is taken straight from the full history rather than the active-
  // category map, which only ever holds the single most recent round per category.
  const cecRecent = draws.rounds
    .filter((r) => r.category === CEC && r.crsCutoff !== null)
    .slice(0, CEC_ROUNDS);

  // CEC is what most readers came to check, so it is the default scope.
  let scope: 'all' | 'cec' = cecRecent.length > 0 ? 'cec' : 'all';

  const results = el('ul', { class: 'verdicts', attrs: { 'aria-live': 'polite' } });
  const bandCount = el('span', {});
  const note = el('p', { class: 'paper__note' });
  const tally = el('p', { class: 'inspect__tally' });

  const input = el('input', {
    class: 'inspect__input pixel',
    attrs: {
      id: 'crs',
      type: 'number',
      min: '0',
      max: '1200',
      inputmode: 'numeric',
      placeholder: '000',
      autocomplete: 'off',
    },
  });

  const render = () => {
    const cec = scope === 'cec';
    const active = cec ? cecRecent : all;

    bandCount.textContent = cec
      ? `Last ${cecRecent.length} CEC rounds`
      : `${all.length} active categories`;
    note.textContent = cec
      ? `Compared against the last ${cecRecent.length} Canadian Experience Class rounds. Past cut-offs are not a prediction of future ones.`
      : 'Compared against the most recent draw in each category. Past cut-offs are not a prediction of future ones.';

    results.replaceChildren();
    tally.textContent = '';
    const score = Number(input.value);

    if (!input.value.trim() || !Number.isFinite(score) || score < 0 || score > 1200) {
      results.append(
        el('li', {
          class: 'empty',
          text: cec
            ? `Enter a score between 0 and 1200 to compare it against the last ${cecRecent.length} CEC rounds.`
            : 'Enter a score between 0 and 1200 to compare it against every active category.',
        }),
      );
      return;
    }

    if (active.length === 0) {
      results.append(
        el('li', { class: 'empty', text: 'No draws in this scope within the last 18 months.' }),
      );
      return;
    }

    let passes = 0;
    for (const round of active) {
      const passed = score >= (round.crsCutoff ?? Infinity);
      if (passed) passes++;

      // In CEC scope every row is the same category, so the round identifies the
      // row and the category name would just repeat down the column.
      results.append(
        el(
          'li',
          { class: 'verdict' },
          el('span', {
            class: 'verdict__name',
            text: cec ? `No. ${round.number} · ${stampDate(round.date)}` : round.categoryLabel,
          }),
          el('span', {
            class: 'verdict__meta',
            text: cec
              ? `cut-off ${int(round.crsCutoff)}`
              : `cut-off ${int(round.crsCutoff)} · ${stampDate(round.date)}`,
          }),
          el(
            'span',
            { class: 'verdict__mark' },
            stamp(passed ? 'APPROVED' : 'DENIED', passed ? 'approved' : 'denied', true),
          ),
        ),
      );
    }

    if (cec) {
      tally.textContent = `A score of ${int(score)} clears the cut-off in ${passes} of the last ${active.length} CEC rounds.`;
    }
  };

  input.addEventListener('input', render);

  const scopeOption = (value: 'all' | 'cec', label: string) => {
    const radio = el('input', {
      class: 'scope__radio',
      attrs: {
        type: 'radio',
        name: 'scope',
        value,
        ...(value === scope ? { checked: 'checked' } : {}),
      },
      on: {
        change: () => {
          scope = value;
          render();
        },
      },
    });
    return el('label', { class: 'scope__option' }, radio, el('span', { text: label }));
  };

  const form = el(
    'form',
    {
      class: 'inspect',
      on: {
        submit: (e) => {
          e.preventDefault();
          render();
        },
      },
    },
    el(
      'div',
      { class: 'inspect__group' },
      el('label', { class: 'inspect__label', text: 'Your CRS score', attrs: { for: 'crs' } }),
      input,
    ),
    el(
      'fieldset',
      { class: 'scope' },
      el('legend', { class: 'inspect__label', text: 'Compare against' }),
      scopeOption('all', 'All categories'),
      scopeOption('cec', 'CEC only'),
    ),
    el('button', { class: 'button', text: 'Inspect', attrs: { type: 'submit' } }),
  );

  const article = el(
    'article',
    { class: 'paper' },
    el(
      'div',
      { class: 'paper__band paper__band--olive' },
      el('span', { text: 'Applicant Verification' }),
      bandCount,
    ),
    el(
      'div',
      { class: 'paper__body' },
      el('h2', { class: 'paper__title pixel', text: 'Score Check' }),
      note,
      form,
      tally,
      results,
    ),
  );

  render();
  return article;
}

export function renderBulletin(draws: Draws): HTMLElement {
  return el('div', {}, headline(draws), inspection(draws));
}
