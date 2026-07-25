/**
 * Display helpers.
 *
 * Every one of these takes a possibly-null value, because the upstream data is
 * genuinely incomplete in places. An em dash is always preferable to a zero — a
 * fabricated number in an immigration figure is the worst failure this site has.
 */

const NBSP = ' ';
const DASH = '—';

export function int(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return DASH;
  return value.toLocaleString('en-CA');
}

/** Axis-width figures: 231533 -> "232K". Only for ticks, never for a stated value. */
export function compactInt(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return DASH;
  if (Math.abs(value) < 1000) return String(Math.round(value));
  return `${Math.round(value / 1000)}K`;
}

/** "2026-07-23" -> "23 JUL 2026", in the clipped register of a form. */
export function stampDate(iso: string | null | undefined): string {
  if (!iso) return DASH;
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return DASH;
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${day}${NBSP}${months[d.getUTCMonth()]}${NBSP}${d.getUTCFullYear()}`;
}

/** Full UTC timestamp for the tie-break rule, where the exact second matters. */
export function stampDateTime(iso: string | null | undefined): string {
  if (!iso) return DASH;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return DASH;
  const time = d.toISOString().slice(11, 19);
  return `${stampDate(iso)}${NBSP}${time}${NBSP}UTC`;
}

export function daysAgo(iso: string | null | undefined): string {
  if (!iso) return DASH;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return DASH;
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 45) return `${days} days ago`;
  const months = Math.round(days / 30.44);
  return months < 24 ? `${months} months ago` : `${Math.round(days / 365.25)} years ago`;
}

export const dash = DASH;
