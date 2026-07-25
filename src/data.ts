import type { Draws, Meta, Processing } from './types';

/**
 * Data is fetched at runtime rather than bundled at build time. The sync Action
 * commits JSON on its own schedule, so decoupling the two means a data refresh
 * never requires an app rebuild.
 */
async function loadJson<T>(name: string): Promise<T> {
  const res = await fetch(`${import.meta.env.BASE_URL}data/${name}`);
  if (!res.ok) throw new Error(`could not load ${name} (HTTP ${res.status})`);
  return (await res.json()) as T;
}

export const loadDraws = () => loadJson<Draws>('draws.json');
export const loadMeta = () => loadJson<Meta>('meta.json');
export const loadProcessing = () => loadJson<Processing>('processing.json');
