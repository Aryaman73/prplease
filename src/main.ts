import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';

import { loadDraws, loadMeta, loadProcessing } from './data';
import { el } from './dom';
import { currentRoute, onRouteChange, type Route } from './router';
import { colophon, masthead, nav } from './shell';
import type { Draws, Processing } from './types';
import { renderBulletin } from './views/bulletin';
import { renderCase } from './views/case';
import { renderLog } from './views/log';
import { renderPoolView } from './views/pool';
import { renderRulebook } from './views/rulebook';

const root = document.querySelector<HTMLElement>('#app');

function failure(message: string) {
  return el(
    'div',
    { class: 'booth' },
    el(
      'article',
      { class: 'paper' },
      el('div', { class: 'paper__band paper__band--rust' }, el('span', { text: 'Discrepancy' })),
      el(
        'div',
        { class: 'paper__body' },
        el('h2', { class: 'paper__title pixel', text: 'Data unavailable' }),
        el('p', { class: 'paper__note', text: message }),
      ),
    ),
  );
}

function view(route: Route, draws: Draws, processing: Processing | null): HTMLElement {
  switch (route.key) {
    case 'log': return renderLog(draws);
    case 'pool': return renderPoolView(draws);
    case 'case': return renderCase(processing);
    case 'rulebook': return renderRulebook();
    default: return renderBulletin(draws);
  }
}

async function main() {
  if (!root) return;

  try {
    // Only draws is load-bearing for the shell; meta and processing each scope a
    // single view, so a failure in either must not take the whole page down.
    const [draws, meta, processing] = await Promise.all([
      loadDraws(),
      loadMeta().catch(() => null),
      loadProcessing().catch(() => null),
    ]);

    const navHost = el('div', {});
    const viewHost = el('div', {});
    const booth = el(
      'main',
      { class: 'booth' },
      masthead(meta, draws.rounds[0]),
      navHost,
      viewHost,
      colophon(meta),
    );

    const paint = (route: Route) => {
      navHost.replaceChildren(nav(route));
      viewHost.replaceChildren(view(route, draws, processing));
    };

    paint(currentRoute());
    onRouteChange(paint);
    root.replaceChildren(booth);
  } catch (err) {
    root.replaceChildren(failure(err instanceof Error ? err.message : 'Unknown error.'));
  }
}

void main();
