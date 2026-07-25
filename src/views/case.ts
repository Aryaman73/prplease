import { el, field } from '../dom';
import { int } from '../format';
import type { Processing, Stream } from '../types';

/**
 * Your File — a personal application tracker.
 *
 * Everything the reader types stays in their own browser (localStorage). Nothing
 * is uploaded, because there is nowhere to upload it to: this is a static site
 * with no backend, and immigration dates are not data to collect casually.
 */

const STORAGE_KEY = 'prplease:file';

interface Stage {
  key: string;
  label: string;
  hint: string;
}

/**
 * The stages of a post-ITA application, in order. ADR is deliberately last and
 * outside the sequence: it can arrive at any point and is not a step forward.
 */
const STAGES: Stage[] = [
  { key: 'ita', label: 'ITA', hint: 'Invitation to Apply' },
  { key: 'aor', label: 'AOR', hint: 'Acknowledgement of Receipt' },
  { key: 'bil', label: 'BIL', hint: 'Biometrics instruction letter' },
  { key: 'biometrics', label: 'Biometrics', hint: 'Biometrics given' },
  { key: 'medical', label: 'Medical', hint: 'Medical passed' },
  { key: 'eligibility', label: 'Eligibility', hint: 'Eligibility passed' },
  { key: 'p1', label: 'P1', hint: 'PR portal 1 received' },
  { key: 'p2', label: 'P2', hint: 'PR portal 2 received' },
  { key: 'copr', label: 'COPR', hint: 'Confirmation of PR issued' },
  { key: 'adr', label: 'ADR', hint: 'Additional document request — can arrive at any stage' },
];

interface FileState {
  stream: string;
  aorMonth: string;
  dates: Record<string, string>;
}

function load(): FileState {
  const empty: FileState = { stream: 'cec', aorMonth: '', dates: {} };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as Partial<FileState>;
    return {
      stream: typeof parsed.stream === 'string' ? parsed.stream : empty.stream,
      aorMonth: typeof parsed.aorMonth === 'string' ? parsed.aorMonth : '',
      dates: parsed.dates && typeof parsed.dates === 'object' ? parsed.dates : {},
    };
  } catch {
    // Corrupt or unavailable storage (private mode, quota) must not break the page.
    return empty;
  }
}

function save(state: FileState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* Storage unavailable — the session still works, it just won't persist. */
  }
}

const DAY = 86_400_000;

function daysBetween(from: string, to: string): number | null {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / DAY);
}

export function renderCase(processing: Processing | null): HTMLElement {
  const state = load();

  const positionHost = el('div', { class: 'fields' });
  const estimate = el('p', { class: 'inspect__tally' });
  const timelineHost = el('div', { class: 'timeline' });

  const streamOf = (key: string): Stream | undefined =>
    processing?.streams.find((s) => s.key === key);

  /** The official read on where the applicant sits in the queue. */
  const renderPosition = () => {
    positionHost.replaceChildren();
    estimate.textContent = '';

    const stream = streamOf(state.stream);
    if (!processing || !stream) {
      positionHost.append(
        el('p', { class: 'empty', text: 'Processing figures are unavailable.' }),
      );
      return;
    }

    positionHost.append(
      field('Stream', stream.label),
      // `raw` rather than the parsed number: IRCC publishes "About 6 months" and
      // reprinting their own wording is more honest than restating it as 183 days.
      field('Current processing time', stream.current.raw ?? '—', !stream.current.known),
      field('Total applications waiting', stream.totalWaiting.raw ?? '—', !stream.totalWaiting.known),
    );

    if (!state.aorMonth) {
      estimate.textContent = '';
      positionHost.append(
        el('p', { class: 'empty', text: 'Enter your AOR month to see your place in the queue.' }),
      );
      return;
    }

    const month = stream.byAorMonth[state.aorMonth];
    if (!month) {
      positionHost.append(
        el('p', {
          class: 'empty',
          text: `IRCC does not publish a queue position for ${state.stream.toUpperCase()} applications received in ${state.aorMonth}.`,
        }),
      );
      return;
    }

    positionHost.append(
      field('People ahead of you', month.peopleAhead.raw ?? '—', !month.peopleAhead.known),
      field('IRCC estimate', month.waitTime.raw ?? '—', !month.waitTime.known),
    );

    if (month.peopleAhead.known && month.peopleAhead.count !== null) {
      estimate.textContent = `${int(month.peopleAhead.count)} applications are ahead of yours.`;
    }
  };

  /** The applicant's own dates, stamped as they are filled in. */
  const renderTimeline = () => {
    timelineHost.replaceChildren();
    const aor = state.dates.aor;

    for (const stage of STAGES) {
      const value = state.dates[stage.key] ?? '';
      const isAdr = stage.key === 'adr';
      const gap = value && aor && stage.key !== 'aor' ? daysBetween(aor, value) : null;

      const input = el('input', {
        class: 'timeline__date',
        attrs: {
          type: 'date',
          value,
          id: `stage-${stage.key}`,
          max: new Date().toISOString().slice(0, 10),
        },
        on: {
          change: (e) => {
            const next = (e.target as HTMLInputElement).value;
            if (next) state.dates[stage.key] = next;
            else delete state.dates[stage.key];
            save(state);
            renderTimeline();
          },
        },
      });

      timelineHost.append(
        el(
          'div',
          { class: `timeline__row${value ? ' timeline__row--done' : ''}` },
          el(
            'div',
            { class: 'timeline__head' },
            el('label', {
              class: 'timeline__label pixel',
              text: stage.label,
              attrs: { for: `stage-${stage.key}` },
            }),
            el('span', { class: 'timeline__hint', text: stage.hint }),
          ),
          input,
          el('span', {
            class: 'timeline__gap',
            text: gap === null ? '' : gap === 0 ? 'same day as AOR' : `${int(gap)} days from AOR`,
          }),
          el(
            'span',
            { class: 'timeline__mark' },
            value
              ? el('span', {
                  class: `stamp ${isAdr ? 'stamp--flag' : 'stamp--approved'}`,
                  text: isAdr ? 'DISCREPANCY' : 'CLEARED',
                })
              : el('span', { class: 'timeline__pending', text: 'pending' }),
          ),
        ),
      );
    }
  };

  const streamSelect = el(
    'select',
    {
      class: 'control__input',
      attrs: { id: 'case-stream' },
      on: {
        change: (e) => {
          state.stream = (e.target as HTMLSelectElement).value;
          save(state);
          renderPosition();
        },
      },
    },
    ...(processing?.streams ?? []).map((s) =>
      el('option', {
        text: s.label,
        attrs: { value: s.key, ...(s.key === state.stream ? { selected: 'selected' } : {}) },
      }),
    ),
  );

  const aorInput = el('input', {
    class: 'control__input',
    attrs: {
      type: 'month',
      id: 'case-aor',
      value: state.aorMonth,
      max: new Date().toISOString().slice(0, 7),
    },
    on: {
      change: (e) => {
        state.aorMonth = (e.target as HTMLInputElement).value;
        save(state);
        renderPosition();
      },
    },
  });

  const controls = el(
    'div',
    { class: 'controls' },
    el(
      'div',
      { class: 'control' },
      el('label', { class: 'control__label', text: 'Stream', attrs: { for: 'case-stream' } }),
      streamSelect,
    ),
    el(
      'div',
      { class: 'control' },
      el('label', { class: 'control__label', text: 'AOR month', attrs: { for: 'case-aor' } }),
      aorInput,
    ),
  );

  const clear = el('button', {
    class: 'button',
    text: 'Clear file',
    attrs: { type: 'button' },
    on: {
      click: () => {
        state.stream = processing?.streams[0]?.key ?? 'cec';
        state.aorMonth = '';
        state.dates = {};
        save(state);
        // Rebuilding the whole view would lose the controls' bound state, so the
        // inputs are reset in place.
        streamSelect.value = state.stream;
        aorInput.value = '';
        renderPosition();
        renderTimeline();
      },
    },
  });

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
        el('span', { text: 'Queue Position' }),
        el('span', {
          text: processing?.updatedUpstream ? `IRCC ${processing.updatedUpstream}` : '',
        }),
      ),
      el(
        'div',
        { class: 'paper__body' },
        el('h2', { class: 'paper__title pixel', text: 'Where You Stand' }),
        el('p', {
          class: 'paper__note',
          text: 'Queue positions come from IRCC’s own published figures for applications received in each month. They are an estimate, not a commitment.',
        }),
        positionHost,
        estimate,
      ),
    ),
    el(
      'article',
      { class: 'paper' },
      el(
        'div',
        { class: 'paper__band paper__band--olive' },
        el('span', { text: 'Your File' }),
        el('span', { text: 'Application milestones' }),
      ),
      el(
        'div',
        { class: 'paper__body' },
        el('h2', { class: 'paper__title pixel', text: 'Milestones' }),
        el('p', {
          class: 'paper__note',
          text: 'Your dates are stored in this browser only. Nothing is uploaded — this site has no server to upload it to. Clearing your browser data will erase them.',
        }),
        timelineHost,
        el('div', { class: 'timeline__actions' }, clear),
      ),
    ),
  );

  renderPosition();
  renderTimeline();
  return view;
}
