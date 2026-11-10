import type { Block } from './model';
import { addDays, fromWall, snapUp, toWall } from './time';

export interface Interval {
  startMin: number;
  endMin: number;
}

/** Local minutes of a scheduled block on `date` (clipped to that day). */
export function blockInterval(b: Block, date: string, tz: string): Interval | undefined {
  if (!b.start || !b.end) return undefined;
  const s = toWall(b.start, tz);
  const lenMin = Math.round((Date.parse(b.end) - Date.parse(b.start)) / 60000);
  if (s.date === date) return { startMin: s.minutes, endMin: s.minutes + lenMin };
  if (s.date < date && toWall(b.end, tz).date >= date) {
    // Started the day before and runs into this one.
    const e = toWall(b.end, tz);
    return { startMin: 0, endMin: e.date === date ? e.minutes : 1440 };
  }
  return undefined;
}

const live = (b: Block) => !b.deletedAt;

/** Blocks that occupy time on `date` and so cannot be overlapped by auto-place. */
export function busyIntervals(blocks: Block[], date: string, tz: string): Interval[] {
  return blocks
    .filter((b) => live(b) && b.status !== 'deferred')
    .map((b) => blockInterval(b, date, tz))
    .filter((i): i is Interval => !!i)
    .sort((a, b) => a.startMin - b.startMin);
}

export interface PlaceOptions {
  date: string;
  tz: string;
  now: Date;
  dayStartMin: number;
  dayEndMin: number;
  snapMin: number;
}

/**
 * Fill the next free gaps with tray items, in order. Returns the updated
 * blocks; items that do not fit before the end of the day are left out.
 */
export function autoPlace(tray: Block[], blocks: Block[], o: PlaceOptions): Block[] {
  const busy = busyIntervals(blocks, o.date, o.tz);
  const nowWall = toWall(o.now, o.tz);
  let cursor = o.dayStartMin;
  if (nowWall.date === o.date) cursor = Math.max(cursor, snapUp(nowWall.minutes, o.snapMin));
  else if (nowWall.date > o.date) return [];

  const placed: Block[] = [];
  const nowIso = o.now.toISOString();
  for (const item of tray) {
    let start = cursor;
    for (;;) {
      const end = start + item.durationMin;
      const clash = busy.find((i) => i.startMin < end && i.endMin > start);
      if (!clash) break;
      start = snapUp(clash.endMin, o.snapMin);
    }
    const end = start + item.durationMin;
    if (end > o.dayEndMin) continue; // a later, shorter item may still fit
    const startDate = fromWall(o.date, start, o.tz);
    placed.push({
      ...item,
      date: o.date,
      start: startDate.toISOString(),
      end: new Date(startDate.getTime() + item.durationMin * 60000).toISOString(),
      updatedAt: nowIso,
    });
    busy.push({ startMin: start, endMin: end });
    busy.sort((a, b) => a.startMin - b.startMin);
  }
  return placed;
}

/**
 * Unfinished work from earlier days moves to today's tray; deferred work
 * whose day has come back becomes a normal tray item. Nothing is deleted.
 */
export function rollover(blocks: Block[], today: string, now: Date): Block[] {
  const nowIso = now.toISOString();
  const changed: Block[] = [];
  for (const b of blocks) {
    if (!live(b)) continue;
    if (b.status === 'todo' && b.date < today) {
      changed.push({
        ...b,
        date: today,
        start: undefined,
        end: undefined,
        rolledFrom: b.rolledFrom ?? b.date,
        updatedAt: nowIso,
      });
    } else if (b.status === 'deferred' && b.date <= today) {
      changed.push({ ...b, status: 'todo', date: today, updatedAt: nowIso });
    }
  }
  return changed;
}

/** Swipe-to-defer: off today's timeline, into tomorrow's tray. */
export function defer(b: Block, now: Date, tz: string): Block {
  const tomorrow = addDays(toWall(now, tz).date, 1);
  return {
    ...b,
    status: 'deferred',
    date: b.date > tomorrow ? b.date : tomorrow,
    start: undefined,
    end: undefined,
    updatedAt: now.toISOString(),
  };
}

/** Move or resize a block to new local minutes on its day. */
export function reschedule(b: Block, date: string, startMin: number, durationMin: number, tz: string, now: Date): Block {
  const start = fromWall(date, startMin, tz);
  return {
    ...b,
    date,
    durationMin,
    start: start.toISOString(),
    end: new Date(start.getTime() + durationMin * 60000).toISOString(),
    updatedAt: now.toISOString(),
  };
}

export function unschedule(b: Block, now: Date): Block {
  return { ...b, start: undefined, end: undefined, updatedAt: now.toISOString() };
}

/** The todo block running right now, if any, and minutes left in it. */
export function currentBlock(blocks: Block[], now: Date): { block: Block; msLeft: number } | undefined {
  const t = now.getTime();
  for (const b of blocks) {
    if (!live(b) || b.status !== 'todo' || !b.start || !b.end) continue;
    const s = Date.parse(b.start);
    const e = Date.parse(b.end);
    if (s <= t && t < e) return { block: b, msLeft: e - t };
  }
  return undefined;
}
