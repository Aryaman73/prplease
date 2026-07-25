export type RouteKey = 'bulletin' | 'log' | 'pool' | 'case' | 'rulebook';

export interface Route {
  key: RouteKey;
  hash: string;
  label: string;
}

/** Hash routing, because Pages serves static files with no SPA rewrite. */
export const ROUTES: Route[] = [
  { key: 'bulletin', hash: '#/', label: 'Bulletin' },
  { key: 'log', hash: '#/log', label: 'Entry Log' },
  { key: 'pool', hash: '#/pool', label: 'The Pool' },
  { key: 'case', hash: '#/file', label: 'Your File' },
  { key: 'rulebook', hash: '#/rulebook', label: 'Rulebook' },
];

export function currentRoute(): Route {
  const hash = location.hash || '#/';
  return ROUTES.find((r) => r.hash === hash) ?? ROUTES[0]!;
}

export function onRouteChange(handler: (route: Route) => void): void {
  window.addEventListener('hashchange', () => handler(currentRoute()));
}
