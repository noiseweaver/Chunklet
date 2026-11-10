import { describe, expect, it } from 'vitest';
import { parse, draftToBlock } from './index';
import { fromWall } from '../time';
import type { Block } from '../model';

const TZ = 'Europe/Amsterdam';
/** A local Amsterdam wall time on a given day as a Date. */
const at = (date: string, hm: string) => {
  const [h, m] = hm.split(':').map(Number) as [number, number];
  return fromWall(date, h * 60 + m, TZ);
};
const DAY = '2026-11-10'; // a Tuesday, UTC+1
const morning = { now: at(DAY, '08:00'), tz: TZ };

const block = (title: string, date: string, from: string, to: string): Block => ({
  id: title,
  title,
  date,
  start: at(date, from).toISOString(),
  end: at(date, to).toISOString(),
  durationMin: 30,
  status: 'todo',
  source: 'local',
  updatedAt: '2026-11-10T00:00:00.000Z',
});

const pick = (text: string, ctx = morning) =>
  parse(text, ctx).map((d) => ({ title: d.title, date: d.date, startMin: d.startMin, durationMin: d.durationMin }));

describe('spec examples', () => {
  it('review PR 30m at 10', () => {
    expect(pick('review PR 30m at 10')).toEqual([{ title: 'review PR', date: DAY, startMin: 600, durationMin: 30 }]);
  });

  it('9 standup, then 2h schematic work, lunch 12:30, emails 20m', () => {
    expect(pick('9 standup, then 2h schematic work, lunch 12:30, emails 20m')).toEqual([
      { title: 'standup', date: DAY, startMin: 540, durationMin: 25 },
      { title: 'schematic work', date: DAY, startMin: 565, durationMin: 120 },
      { title: 'lunch', date: DAY, startMin: 750, durationMin: 25 },
      { title: 'emails', date: DAY, startMin: undefined, durationMin: 20 },
    ]);
  });

  it('call supplier after lunch (existing lunch block)', () => {
    const ctx = { ...morning, existing: [block('Lunch', DAY, '12:30', '13:00')] };
    expect(pick('call supplier after lunch', ctx)).toEqual([
      { title: 'call supplier', date: DAY, startMin: 780, durationMin: 25 },
    ]);
  });

  it('call supplier after lunch (lunch in the same input)', () => {
    expect(pick('lunch 12:30, call supplier after lunch')[1]).toEqual({
      title: 'call supplier',
      date: DAY,
      startMin: 775,
      durationMin: 25,
    });
  });

  it('call supplier after lunch with no lunch block goes to the tray with a warning', () => {
    const [d] = parse('call supplier after lunch', morning);
    expect(d?.startMin).toBeUndefined();
    expect(d?.title).toBe('call supplier');
    expect(d?.warnings.join(' ')).toMatch(/lunch/);
  });

  it('gym tomorrow 18:00 1h', () => {
    expect(pick('gym tomorrow 18:00 1h')).toEqual([
      { title: 'gym', date: '2026-11-11', startMin: 1080, durationMin: 60 },
    ]);
  });
});

describe('ambiguous times are never guessed silently', () => {
  it('"at 7" late in the evening asks', () => {
    const [d] = parse('write report at 7', { now: at(DAY, '20:30'), tz: TZ });
    expect(d?.startMin).toBeUndefined();
    expect(d?.ambiguity?.options.map((o) => [o.date, o.startMin])).toEqual([
      ['2026-11-11', 420],
      ['2026-11-11', 1140],
    ]);
  });

  it('a choice resolves the ambiguity', () => {
    const [d] = parse('write report at 7', { now: at(DAY, '20:30'), tz: TZ, choices: { 0: 1 } });
    expect([d?.date, d?.startMin]).toEqual(['2026-11-11', 1140]);
    expect(d?.ambiguity?.chosen).toBe(1);
  });

  it('a bare hour already past asks, and later "then" items wait for it', () => {
    const drafts = parse('9 standup, then 2h schematic work', { now: at(DAY, '09:33'), tz: TZ });
    expect(drafts[0]?.startMin).toBeUndefined();
    expect(drafts[0]?.ambiguity?.options.map((o) => [o.date, o.startMin])).toEqual([
      [DAY, 540],
      [DAY, 1260],
      ['2026-11-11', 540],
    ]);
    expect(drafts[1]?.startMin).toBeUndefined();

    const chosen = parse('9 standup, then 2h schematic work', { now: at(DAY, '09:33'), tz: TZ, choices: { 0: 0 } });
    expect(chosen.map((d) => d.startMin)).toEqual([540, 565]);
  });

  it('planning another day uses that day and the daytime reading', () => {
    const [d] = parse('write report at 7', { now: at(DAY, '20:30'), tz: TZ, date: '2026-11-12' });
    expect([d?.date, d?.startMin, d?.ambiguity]).toEqual(['2026-11-12', 420, undefined]);
    expect(parse('emails', { now: at(DAY, '20:30'), tz: TZ, date: '2026-11-12' })[0]?.date).toBe('2026-11-12');
  });

  it('explicit meridiem or 24h time is not ambiguous', () => {
    const evening = { now: at(DAY, '20:30'), tz: TZ };
    expect(parse('call at 7pm', evening)[0]?.ambiguity).toBeUndefined();
    expect(parse('call 19:00', evening)[0]?.ambiguity).toBeUndefined();
    expect(parse('call tomorrow at 7', evening)[0]?.ambiguity).toBeUndefined();
  });
});

describe('24h and 12h input', () => {
  it.each([
    ['call at 7pm', 1140],
    ['sync 7:30 am', 450],
    ['sync 19:00', 1140],
    ['sync 09:00', 540],
    ['sync 14.30', 870],
    ['meeting at 3', 900],
    ['meeting at 12', 720],
    ['call at 10:07', 605],
  ])('%s', (text, startMin) => {
    expect(parse(text, morning)[0]?.startMin).toBe(startMin);
  });
});

describe('durations', () => {
  it.each([
    ['write 1h30', 90],
    ['write 1.5h', 90],
    ['write 1h 15m', 75],
    ['write half an hour', 30],
    ['write an hour', 60],
    ['write 90 minutes', 90],
    ['write 45 min', 45],
    ['write', 25],
  ])('%s', (text, durationMin) => {
    const [d] = parse(text, morning);
    expect(d?.durationMin).toBe(durationMin);
    expect(d?.title).toBe('write');
  });

  it('drops filler words around a duration', () => {
    expect(parse('plan for 45 min', morning)[0]?.title).toBe('plan');
  });
});

describe('titles and splitting', () => {
  it('keeps numbers that are part of the title', () => {
    expect(pick('call 3 suppliers at 11')[0]?.title).toBe('call 3 suppliers');
    expect(pick('review PR 30')[0]).toMatchObject({ title: 'review PR 30', startMin: undefined });
  });

  it('splits on newlines, commas, semicolons and "and then"', () => {
    expect(pick('a at 9\nb at 10; c, d and then e 10m').map((d) => d.title)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('ignores empty segments', () => {
    expect(pick('a,, ,b')).toHaveLength(2);
  });

  it('"then" after an untimed item stays untimed', () => {
    expect(pick('emails then report').map((d) => d.startMin)).toEqual([undefined, undefined]);
  });

  it('before an anchor', () => {
    const ctx = { ...morning, existing: [block('Lunch', DAY, '12:30', '13:00')] };
    expect(pick('prep slides before lunch 20m', ctx)[0]).toMatchObject({ title: 'prep slides', startMin: 730 });
  });

  it('only anchors to blocks on the same day', () => {
    const ctx = { ...morning, existing: [block('Lunch', '2026-11-09', '12:30', '13:00')] };
    expect(pick('call supplier after lunch', ctx)[0]?.startMin).toBeUndefined();
  });

  it('weekday names', () => {
    expect(pick('retro friday 15:00')[0]).toMatchObject({ title: 'retro', date: '2026-11-13', startMin: 900 });
  });
});

describe('draftToBlock', () => {
  it('crosses midnight and keeps the start day', () => {
    const [d] = parse('deploy 23:30 1h', morning);
    const b = draftToBlock(d!, TZ, morning.now, 'x');
    expect(b.date).toBe(DAY);
    expect(b.start).toBe('2026-11-10T22:30:00.000Z');
    expect(b.end).toBe('2026-11-10T23:30:00.000Z');
  });

  it('a time in the spring-forward gap moves forward (Europe/Amsterdam)', () => {
    const ctx = { now: at('2026-03-29', '00:30'), tz: TZ };
    const [d] = parse('check backups at 02:30', ctx);
    const b = draftToBlock(d!, TZ, ctx.now, 'x');
    expect(b.start).toBe('2026-03-29T01:30:00.000Z'); // 03:30 CEST
  });

  it('a time in the autumn overlap takes the first occurrence', () => {
    const ctx = { now: at('2026-10-25', '00:30'), tz: TZ };
    const [d] = parse('check backups at 02:30', ctx);
    const b = draftToBlock(d!, TZ, ctx.now, 'x');
    expect(b.start).toBe('2026-10-25T00:30:00.000Z'); // 02:30 CEST
    expect(b.end).toBe('2026-10-25T00:55:00.000Z');
  });

  it('an untimed draft becomes a tray block', () => {
    const [d] = parse('emails 20m', morning);
    const b = draftToBlock(d!, TZ, morning.now, 'x');
    expect(b).toMatchObject({ title: 'emails', date: DAY, durationMin: 20, status: 'todo', source: 'local' });
    expect(b.start).toBeUndefined();
  });
});
