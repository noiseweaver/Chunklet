import { describe, expect, it } from 'vitest';
import { addDays, fromWall, offsetMin, toWall } from './time';

const TZ = 'Europe/Amsterdam';

describe('time helpers (Europe/Amsterdam)', () => {
  it('converts winter and summer wall times', () => {
    expect(fromWall('2026-01-15', 9 * 60, TZ).toISOString()).toBe('2026-01-15T08:00:00.000Z');
    expect(fromWall('2026-07-15', 9 * 60, TZ).toISOString()).toBe('2026-07-15T07:00:00.000Z');
  });

  it('handles the spring-forward gap', () => {
    expect(fromWall('2026-03-29', 150, TZ).toISOString()).toBe('2026-03-29T01:30:00.000Z');
    expect(toWall('2026-03-29T01:30:00.000Z', TZ)).toEqual({ date: '2026-03-29', minutes: 210 });
  });

  it('handles the autumn overlap by taking the first occurrence', () => {
    expect(fromWall('2026-10-25', 150, TZ).toISOString()).toBe('2026-10-25T00:30:00.000Z');
  });

  it('rolls minutes past midnight into the next day', () => {
    expect(fromWall('2026-11-10', 24 * 60 + 30, TZ).toISOString()).toBe('2026-11-10T23:30:00.000Z');
  });

  it('reports offsets', () => {
    expect(offsetMin(Date.parse('2026-01-01T12:00:00Z'), TZ)).toBe(60);
    expect(offsetMin(Date.parse('2026-07-01T12:00:00Z'), TZ)).toBe(120);
  });

  it('adds days across month and year ends', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});
