import { describe, expect, it } from 'vitest';
import type { Block } from './model';
import { outlookComposeUrl, toIcs } from './calendar';

const b: Block = {
  id: 'abc',
  title: 'Review PR, then merge; fast',
  date: '2026-11-10',
  start: '2026-11-10T09:00:00.000Z',
  end: '2026-11-10T09:30:00.000Z',
  durationMin: 30,
  status: 'todo',
  source: 'local',
  updatedAt: '2026-11-10T08:00:00.000Z',
};

describe('outlookComposeUrl', () => {
  it('builds the Outlook web compose link', () => {
    const url = new URL(outlookComposeUrl(b)!);
    expect(url.origin + url.pathname).toBe('https://outlook.office.com/calendar/deeplink/compose');
    expect(url.searchParams.get('subject')).toBe(b.title);
    expect(url.searchParams.get('startdt')).toBe(b.start);
    expect(url.searchParams.get('enddt')).toBe(b.end);
    expect(outlookComposeUrl(b)).not.toContain('+');
  });

  it('has no link for unscheduled blocks', () => {
    expect(outlookComposeUrl({ ...b, start: undefined, end: undefined })).toBeUndefined();
  });
});

describe('toIcs', () => {
  it('writes one escaped VEVENT per scheduled block, with CRLF line ends', () => {
    const ics = toIcs([b, { ...b, id: 'tray', start: undefined, end: undefined }], new Date('2026-11-10T08:00:00Z'));
    expect(ics).toContain('DTSTART:20261110T090000Z\r\n');
    expect(ics).toContain('DTEND:20261110T093000Z\r\n');
    expect(ics).toContain('SUMMARY:Review PR\\, then merge\; fast\r\n');
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(ics.split('\r\n').every((l) => new TextEncoder().encode(l).length <= 75)).toBe(true);
  });

  it('folds long titles', () => {
    const ics = toIcs([{ ...b, title: 'x'.repeat(200) }], new Date());
    expect(ics).toMatch(/\r\n x/);
    expect(ics.split('\r\n').every((l) => new TextEncoder().encode(l).length <= 75)).toBe(true);
  });
});
