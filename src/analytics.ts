/**
 * GoatCounter page views, shared with the aryamans.me dashboard. Only the live
 * host loads the script, so dev and preview servers never count.
 *
 * Views are hash routes, which GoatCounter's automatic onload count would miss,
 * so it is disabled and every route (the first load included) is counted here.
 * The path keeps the /prplease/ prefix to stay apart from the main site's pages.
 */

declare global {
  interface Window {
    goatcounter?: { count?: (vars: { path: string }) => void };
  }
}

const LIVE_HOST = 'aryamans.me';

function countView(): void {
  window.goatcounter?.count?.({ path: location.pathname + location.search + location.hash });
}

export function startAnalytics(): void {
  if (location.hostname !== LIVE_HOST) return;

  const script = document.createElement('script');
  script.async = true;
  script.src = 'https://gc.zgo.at/count.js';
  script.dataset.goatcounter = 'https://aryamans.goatcounter.com/count';
  script.dataset.goatcounterSettings = JSON.stringify({ no_onload: true });
  script.addEventListener('load', countView);
  document.head.append(script);

  window.addEventListener('hashchange', countView);
}
