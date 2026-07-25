import { el } from './dom';
import { int, stampDate } from './format';
import { ROUTES, type Route } from './router';
import type { Meta, Round } from './types';

/** A stencilled sign bolted above the window. */
export function masthead(meta: Meta | null, latest: Round | undefined) {
  return el(
    'header',
    { class: 'masthead' },
    el(
      'div',
      {},
      el('h1', { class: 'masthead__title pixel', text: 'PR, PLEASE' }),
      el('p', { class: 'masthead__sub', text: 'Ministry of Immigration · Daily Bulletin' }),
    ),
    el(
      'div',
      { class: 'datestamp pixel' },
      el('span', { text: 'LAST DRAW' }),
      latest ? stampDate(latest.date) : '—',
      el('span', { text: meta ? `RECORDS ${int(meta.sources.draws.records)}` : '' }),
    ),
  );
}

/** Index tabs on a file divider. */
export function nav(active: Route) {
  return el(
    'nav',
    { class: 'tabs', attrs: { 'aria-label': 'Sections' } },
    ...ROUTES.map((route) =>
      el('a', {
        class: `tab${route.key === active.key ? ' tab--active' : ''}`,
        text: route.label,
        attrs: {
          href: route.hash,
          ...(route.key === active.key ? { 'aria-current': 'page' } : {}),
        },
      }),
    ),
  );
}

export function colophon(meta: Meta | null) {
  return el(
    'footer',
    { class: 'colophon' },
    el(
      'p',
      {},
      'Unofficial. Data derived from IRCC public feeds; not affiliated with or endorsed by IRCC or the Government of Canada. Always confirm against the ',
      el('a', {
        text: 'official rounds page',
        attrs: {
          href: 'https://www.canada.ca/en/immigration-refugees-citizenship/services/immigrate-canada/express-entry/submit-profile/rounds-invitations.html',
          rel: 'noopener',
        },
      }),
      '.',
    ),
    meta
      ? el('p', {
          text: `Data last changed ${stampDate(meta.dataChangedAt)} · processing figures published by IRCC ${
            meta.sources.processing.upstreamUpdated ?? '—'
          }.`,
        })
      : null,
  );
}
