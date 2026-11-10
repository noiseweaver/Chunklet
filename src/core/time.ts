/**
 * Wall-clock <-> UTC conversion for an IANA time zone, using only Intl.
 * Local times are a day string (YYYY-MM-DD) plus minutes from midnight.
 */

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    fmtCache.set(tz, f);
  }
  return f;
}

export interface Wall {
  date: string;
  minutes: number;
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

function parts(instantMs: number, tz: string) {
  const out: Record<string, number> = {};
  for (const p of fmt(tz).formatToParts(new Date(instantMs))) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  return out as { year: number; month: number; day: number; hour: number; minute: number; second: number };
}

/** Offset of `tz` from UTC at an instant, in minutes (Amsterdam winter: +60). */
export function offsetMin(instantMs: number, tz: string): number {
  const p = parts(instantMs, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(instantMs / 1000) * 1000) / 60000);
}

export function toWall(instant: Date | string | number, tz: string): Wall {
  const ms = typeof instant === 'number' ? instant : new Date(instant).getTime();
  const p = parts(ms, tz);
  return { date: `${p.year}-${pad(p.month)}-${pad(p.day)}`, minutes: p.hour * 60 + p.minute };
}

function dateToUtcMs(date: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d);
}

/** Days are allowed to overflow: minutes >= 1440 roll into the next day. */
export function fromWall(date: string, minutes: number, tz: string): Date {
  const guess = dateToUtcMs(date) + minutes * 60000; // wall time read as if UTC
  const before = guess - offsetMin(guess - 12 * 3600000, tz) * 60000;
  const after = guess - offsetMin(guess + 12 * 3600000, tz) * 60000;
  const target = toWall(guess, 'UTC');
  const valid = [before, after]
    .filter((c) => {
      const w = toWall(c, tz);
      return w.date === target.date && w.minutes === target.minutes;
    })
    .sort((a, b) => a - b);
  // Overlap (clocks go back): take the first occurrence.
  // Gap (clocks go forward): no candidate matches; the pre-transition offset
  // pushes the time forward by the gap, e.g. 02:30 -> 03:30.
  return new Date(valid[0] ?? before);
}

export function addDays(date: string, n: number): string {
  return new Date(dateToUtcMs(date) + n * 86400000).toISOString().slice(0, 10);
}

export function today(now: Date, tz: string): string {
  return toWall(now, tz).date;
}

export function formatHM(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

export const snap = (min: number, step = 5) => Math.round(min / step) * step;
export const snapUp = (min: number, step = 5) => Math.ceil(min / step) * step;

/** Weekday 0 (Sunday) .. 6 for a day string. */
export function weekday(date: string): number {
  return new Date(dateToUtcMs(date)).getUTCDay();
}
