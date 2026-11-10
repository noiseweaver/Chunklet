import { describe, expect, it } from 'vitest';
import type { Block } from './model';
import { autoPlace, currentBlock, defer, rollover, blockInterval } from './schedule';
import { fromWall, toWall } from './time';

const TZ = 'Europe/Amsterdam';
const DAY = '2026-11-10';
const at = (date: string, hm: string) => {
  const [h, m] = hm.split(':').map(Number) as [number, number];
  return fromWall(date, h * 60 + m, TZ);
};
let n = 0;
const mk = (p: Partial<Block>): Block => ({
  id: `b${++n}`,
  title: 't',
  date: DAY,
  durationMin: 25,
  status: 'todo',
  source: 'local',
  updatedAt: '2026-11-01T00:00:00.000Z',
  ...p,
});
const timed = (from: string, to: string, p: Partial<Block> = {}) =>
  mk({ start: at(DAY, from).toISOString(), end: at(DAY, to).toISOString(), ...p });
const hm = (iso?: string) => (iso ? new Date(toWall(iso, TZ).minutes * 60000).toISOString().slice(11, 16) : undefined);
const opts = (now: string) => ({ date: DAY, tz: TZ, now: at(DAY, now), dayStartMin: 420, dayEndMin: 1320, snapMin: 5 });

describe('autoPlace', () => {
  it('fills the next free gap from now, around existing blocks', () => {
    const busy = [timed('10:00', '10:30'), timed('10:45', '12:00')];
    const tray = [mk({ title: 'a', durationMin: 20 }), mk({ title: 'b', durationMin: 30 }), mk({ title: 'c', durationMin: 10 })];
    const placed = autoPlace(tray, busy, opts('09:52'));
    expect(placed.map((b) => [b.title, hm(b.start), hm(b.end)])).toEqual([
      ['a', '12:00', '12:20'],
      ['b', '12:20', '12:50'],
      ['c', '10:30', '10:40'],
    ]);
  });

  it('uses a gap that is big enough', () => {
    const busy = [timed('09:00', '09:30'), timed('09:45', '11:00')];
    const placed = autoPlace([mk({ durationMin: 15 })], busy, opts('08:58'));
    expect(hm(placed[0]?.start)).toBe('09:30');
  });

  it('starts at the start of the day when planning ahead', () => {
    const placed = autoPlace([mk({})], [], { ...opts('20:00'), date: '2026-11-11' });
    expect(placed[0]?.start).toBe(at('2026-11-11', '07:00').toISOString());
  });

  it('ignores done-but-deleted and deferred blocks, keeps done blocks as busy', () => {
    const busy = [timed('09:00', '10:00', { status: 'done' }), timed('10:00', '11:00', { status: 'deferred' }), timed('11:00', '12:00', { deletedAt: 'x' })];
    expect(hm(autoPlace([mk({})], busy, opts('09:00'))[0]?.start)).toBe('10:00');
  });

  it('leaves items that do not fit before the end of the day', () => {
    const placed = autoPlace([mk({ durationMin: 120 }), mk({ durationMin: 20 })], [], opts('20:30'));
    expect(placed.map((b) => b.durationMin)).toEqual([20]);
  });

  it('places nothing on past days', () => {
    expect(autoPlace([mk({})], [], { ...opts('09:00'), date: '2026-11-09' })).toEqual([]);
  });
});

describe('rollover', () => {
  it('moves unfinished blocks from earlier days to today\'s tray, keeping where they came from', () => {
    const old = mk({ date: '2026-11-08', start: at('2026-11-08', '10:00').toISOString(), end: at('2026-11-08', '10:25').toISOString() });
    const [r] = rollover([old], DAY, at(DAY, '08:00'));
    expect(r).toMatchObject({ id: old.id, date: DAY, start: undefined, end: undefined, rolledFrom: '2026-11-08', status: 'todo' });
  });

  it('keeps the first original day across several rollovers', () => {
    const [r] = rollover([mk({ date: '2026-11-09', rolledFrom: '2026-11-07' })], DAY, at(DAY, '08:00'));
    expect(r?.rolledFrom).toBe('2026-11-07');
  });

  it('never touches done, deleted or today\'s blocks', () => {
    const blocks = [mk({ date: '2026-11-08', status: 'done' }), mk({ date: '2026-11-08', deletedAt: 'x' }), mk({})];
    expect(rollover(blocks, DAY, at(DAY, '08:00'))).toEqual([]);
  });

  it('brings deferred blocks back as todo when their day comes', () => {
    const [r] = rollover([mk({ status: 'deferred' })], DAY, at(DAY, '08:00'));
    expect(r).toMatchObject({ status: 'todo', date: DAY });
  });
});

describe('defer, current block, intervals', () => {
  it('defer moves a block to tomorrow\'s tray', () => {
    const b = defer(timed('10:00', '10:30'), at(DAY, '09:00'), TZ);
    expect(b).toMatchObject({ status: 'deferred', date: '2026-11-11', start: undefined, end: undefined });
  });

  it('finds the running block and time left', () => {
    const b = timed('10:00', '10:30');
    const cur = currentBlock([b], at(DAY, '10:12'));
    expect(cur?.block.id).toBe(b.id);
    expect(cur?.msLeft).toBe(18 * 60000);
    expect(currentBlock([{ ...b, status: 'done' }], at(DAY, '10:12'))).toBeUndefined();
  });

  it('a block crossing midnight shows on both days', () => {
    const b = timed('23:30', '23:30', { end: at('2026-11-11', '00:30').toISOString() });
    expect(blockInterval(b, DAY, TZ)).toEqual({ startMin: 1410, endMin: 1470 });
    expect(blockInterval(b, '2026-11-11', TZ)).toEqual({ startMin: 0, endMin: 30 });
  });
});
