export type RouteKey = 'bulletin' | 'log' | 'pool' | 'highwage' | 'admissions' | 'case' | 'rulebook';

export type GroupKey = 'draws' | 'admissions' | 'case' | 'rulebook';

export interface Route {
  key: RouteKey;
  hash: string;
  label: string;
  group: GroupKey;
}

/**
 * The top row of the index. Seven pixel-face labels don't fit one line of the
 * booth at 16px, so the four draw views share a group and get a sub-row.
 */
export const GROUPS: { key: GroupKey; label: string }[] = [
  { key: 'draws', label: 'Draws' },
  { key: 'admissions', label: 'Admissions' },
  { key: 'case', label: 'Your File' },
  { key: 'rulebook', label: 'Rulebook' },
];

/** Hash routing, because Pages serves static files with no SPA rewrite. */
export const ROUTES: Route[] = [
  { key: 'bulletin', hash: '#/', label: 'Bulletin', group: 'draws' },
  { key: 'log', hash: '#/log', label: 'Entry Log', group: 'draws' },
  { key: 'pool', hash: '#/pool', label: 'The Pool', group: 'draws' },
  { key: 'highwage', hash: '#/high-wage', label: 'High Wage', group: 'draws' },
  { key: 'admissions', hash: '#/admissions', label: 'Admissions', group: 'admissions' },
  { key: 'case', hash: '#/file', label: 'Your File', group: 'case' },
  { key: 'rulebook', hash: '#/rulebook', label: 'Rulebook', group: 'rulebook' },
];

export function currentRoute(): Route {
  const hash = location.hash || '#/';
  return ROUTES.find((r) => r.hash === hash) ?? ROUTES[0]!;
}

export function onRouteChange(handler: (route: Route) => void): void {
  window.addEventListener('hashchange', () => handler(currentRoute()));
}
