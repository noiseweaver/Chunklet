import * as chrono from 'chrono-node';
import type { Block } from '../model';
import { DEFAULT_SETTINGS } from '../model';
import { addDays, formatHM, fromWall, snap, toWall } from '../time';

export interface ParseContext {
  now: Date;
  tz?: string;
  /** Blocks already saved, used to resolve "after lunch". */
  existing?: Block[];
  defaultDurationMin?: number;
  snapMin?: number;
  /** Picks for ambiguous drafts: draft index -> option index. */
  choices?: Record<number, number>;
}

export interface TimeOption {
  date: string;
  startMin: number;
  label: string;
}

export interface Draft {
  index: number;
  raw: string;
  title: string;
  date: string;
  /** Minutes from local midnight; undefined means unscheduled (tray). */
  startMin?: number;
  durationMin: number;
  explicitDuration: boolean;
  ambiguity?: { reason: string; options: TimeOption[]; chosen?: number };
  warnings: string[];
}

interface Segment {
  raw: string;
  linked: boolean;
}

interface Extracted {
  title: string;
  date?: string;
  startMin?: number;
  durationMin?: number;
  ambiguity?: Draft['ambiguity'];
  anchor?: { kind: 'after' | 'before'; name: string };
}

// ---------------------------------------------------------------- splitting

const SEPARATOR = /(\n|;|,|\band\s+then\b|\bthen\b)/i;

export function split(text: string): Segment[] {
  const out: Segment[] = [];
  let linked = false;
  for (const piece of text.split(SEPARATOR)) {
    if (SEPARATOR.test(piece) && piece.trim().length > 0 && /then/i.test(piece)) {
      linked = true;
      continue;
    }
    if (piece === '\n' || piece === ';' || piece === ',') continue;
    if (piece.trim() === '') continue;
    out.push({ raw: piece.trim(), linked });
    linked = false;
  }
  return out;
}

// ---------------------------------------------------------------- durations

type DurationRule = [RegExp, (m: RegExpExecArray) => number];

const DURATIONS: DurationRule[] = [
  [/\b(?:an?\s+|one\s+)?hour\s+and\s+a\s+half\b/i, () => 90],
  [/\bhalf\s+(?:an?\s+)?hour\b/i, () => 30],
  [/\b(?:a\s+)?quarter\s+(?:of\s+an\s+)?hour\b/i, () => 15],
  [
    /\b(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)(?:\s*(\d{1,2})\s*(?:minutes?|mins?|m)?)?(?![a-z:])/i,
    (m) => Math.round(parseFloat(m[1]!) * 60) + (m[2] ? Number(m[2]) : 0),
  ],
  [/\b(\d+)\s*(?:minutes?|mins?|m)(?![a-z])/i, (m) => Number(m[1])],
  [/\b(?:an|one)\s+hour\b/i, () => 60],
];

function takeDuration(s: string): [string, number | undefined] {
  for (const [re, toMin] of DURATIONS) {
    const m = re.exec(s);
    if (m) return [s.slice(0, m.index) + ' ' + s.slice(m.index + m[0].length), toMin(m)];
  }
  return [s, undefined];
}

// ---------------------------------------------------------------- times

/** Bare hours read as working-day times: 7-11 morning, 12 noon, 1-6 afternoon. */
const daytimeHour = (h: number) => (h >= 1 && h <= 6 ? h + 12 : h);
const otherHalf = (h: number) => (h >= 12 ? h - 12 : h + 12);

function fakeLocal(now: Date, tz: string): Date {
  // chrono works in the runtime's local zone; give it the wall clock of `tz`.
  const w = toWall(now, tz);
  const [y, m, d] = w.date.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d, Math.floor(w.minutes / 60), w.minutes % 60);
}

const pad = (n: number) => String(n).padStart(2, '0');

function optionLabel(date: string, startMin: number, todayStr: string): string {
  const day = date === todayStr ? 'today' : date === addDays(todayStr, 1) ? 'tomorrow' : date;
  return `${day} ${formatHM(startMin)}`;
}

function extract(raw: string, index: number, ctx: Required<Pick<ParseContext, 'now' | 'tz'>> & ParseContext): Extracted {
  const tz = ctx.tz;
  const nowWall = toWall(ctx.now, tz);
  let s = ' ' + raw + ' ';

  // "14.30" is a common way to write 14:30 here.
  s = s.replace(/\b(\d{1,2})\.(\d{2})\b(?!\s*h)/gi, '$1:$2');

  let durationMin: number | undefined;
  [s, durationMin] = takeDuration(s);

  // "after lunch" / "before standup" anchor to another block, unless it is a time ("after 3pm").
  let anchor: Extracted['anchor'];
  const am = /\b(after|before)\s+(.+?)\s*$/i.exec(s);
  if (am && chrono.parse(am[2]!, fakeLocal(ctx.now, tz)).length === 0) {
    anchor = { kind: am[1]!.toLowerCase() as 'after' | 'before', name: am[2]!.trim().toLowerCase() };
    s = s.slice(0, am.index);
  }

  let date: string | undefined;
  let hour: number | undefined;
  let minute = 0;
  let meridiemKnown = false;

  const ref = fakeLocal(ctx.now, tz);
  const result = chrono.parse(s, ref, { forwardDate: true })[0];
  if (result) {
    const c = result.start;
    if (c.isCertain('day') || c.isCertain('weekday')) {
      date = `${c.get('year')}-${pad(c.get('month')!)}-${pad(c.get('day')!)}`;
    }
    if (c.isCertain('hour')) {
      hour = c.get('hour')!;
      minute = c.get('minute') ?? 0;
      meridiemKnown = c.isCertain('meridiem') || /\b0\d:\d\d/.test(result.text);
    }
    s = s.slice(0, result.index) + ' ' + s.slice(result.index + result.text.length);
  }

  // A leading bare hour: "9 standup", "9:15 standup".
  if (hour === undefined) {
    const lead = /^\s*(\d{1,2})(?::(\d{2}))?\s+(?=[^\d\s])/.exec(s);
    if (lead && Number(lead[1]) <= 23 && (!lead[2] || Number(lead[2]) < 60)) {
      hour = Number(lead[1]);
      minute = lead[2] ? Number(lead[2]) : 0;
      meridiemKnown = lead[1]!.length === 2 && lead[1]!.startsWith('0');
      s = s.slice(lead[0].length);
    }
  }

  let startMin: number | undefined;
  let ambiguity: Extracted['ambiguity'];
  if (hour !== undefined) {
    if (meridiemKnown || hour === 0 || hour > 12) {
      startMin = hour * 60 + minute;
    } else {
      const def = daytimeHour(hour) * 60 + minute;
      const alt = otherHalf(daytimeHour(hour)) * 60 + minute;
      if (date !== undefined || def >= nowWall.minutes) {
        startMin = def;
      } else {
        const todayStr = nowWall.date;
        const tomorrow = addDays(todayStr, 1);
        const laterToday = [def, alt].some((x) => x > nowWall.minutes);
        const raw: [string, number][] = laterToday
          ? [[todayStr, def], [todayStr, alt], [tomorrow, def]]
          : [[tomorrow, def], [tomorrow, alt]];
        const options = raw
          .sort((a, b) => a[0].localeCompare(b[0]) || a[1] - b[1])
          .map(([d, m]) => ({ date: d, startMin: m, label: optionLabel(d, m, todayStr) }));
        ambiguity = {
          reason: `${formatHM(def)} has already passed today and has no am/pm`,
          options,
        };
        const choice = ctx.choices?.[index];
        const picked = choice !== undefined ? options[choice] : undefined;
        if (picked) {
          ambiguity.chosen = choice;
          date = picked.date;
          startMin = picked.startMin;
        }
      }
    }
  }

  return { title: cleanTitle(s), date, startMin, durationMin, ambiguity, anchor };
}

const FILLER = '(?:at|for|on|by|from|around|@|-|–|—|:)';

function cleanTitle(s: string): string {
  let t = s.replace(/\s+/g, ' ').trim();
  let prev = '';
  while (prev !== t) {
    prev = t;
    t = t
      .replace(new RegExp(`^${FILLER}(?:\\s+|$)`, 'i'), '')
      .replace(new RegExp(`(?:^|\\s+)${FILLER}$`, 'i'), '')
      .replace(new RegExp(`\\s+${FILLER}\\s+${FILLER}(?=\\s|$)`, 'gi'), ' ')
      .trim();
  }
  return t || 'Untitled';
}

// ---------------------------------------------------------------- main

export function parse(text: string, context: ParseContext): Draft[] {
  const ctx = { tz: DEFAULT_SETTINGS.tz, ...context };
  const tz = ctx.tz;
  const defaultDuration = ctx.defaultDurationMin ?? DEFAULT_SETTINGS.defaultDurationMin;
  const step = ctx.snapMin ?? DEFAULT_SETTINGS.snapMin;
  const todayStr = toWall(ctx.now, tz).date;

  const drafts: Draft[] = [];
  split(text).forEach((seg, index) => {
    const x = extract(seg.raw, index, ctx);
    const prev = drafts[drafts.length - 1];
    const durationMin = Math.max(step, snap(x.durationMin ?? defaultDuration, step));
    const draft: Draft = {
      index,
      raw: seg.raw,
      title: x.title,
      date: x.date ?? (seg.linked && prev ? prev.date : todayStr),
      startMin: x.startMin !== undefined ? snap(x.startMin, step) : undefined,
      durationMin,
      explicitDuration: x.durationMin !== undefined,
      ambiguity: x.ambiguity,
      warnings: [],
    };

    if (draft.startMin === undefined && !draft.ambiguity) {
      if (seg.linked && prev) {
        if (prev.startMin !== undefined) {
          draft.startMin = prev.startMin + prev.durationMin;
          draft.date = prev.date;
        } else if (prev.ambiguity && prev.ambiguity.chosen === undefined) {
          draft.warnings.push('Starts after the item above once its time is picked.');
        }
      } else if (x.anchor) {
        const found = findAnchor(x.anchor.name, draft.date, drafts, ctx.existing ?? [], tz);
        if (found) {
          draft.startMin = x.anchor.kind === 'after' ? found.endMin : found.startMin - durationMin;
        } else {
          draft.warnings.push(`No "${x.anchor.name}" block found on ${draft.date}, so this goes to the tray.`);
        }
      }
    }

    if (draft.startMin !== undefined && draft.startMin >= 1440) {
      draft.date = addDays(draft.date, Math.floor(draft.startMin / 1440));
      draft.startMin = draft.startMin % 1440;
    }
    drafts.push(draft);
  });
  return drafts;
}

function findAnchor(
  name: string,
  date: string,
  drafts: Draft[],
  existing: Block[],
  tz: string,
): { startMin: number; endMin: number } | undefined {
  const matches = (title: string) => {
    const t = title.toLowerCase();
    return t.includes(name) || name.includes(t);
  };
  for (const d of [...drafts].reverse()) {
    if (d.date === date && d.startMin !== undefined && matches(d.title)) {
      return { startMin: d.startMin, endMin: d.startMin + d.durationMin };
    }
  }
  for (const b of existing) {
    if (b.deletedAt || !b.start || !b.end || !matches(b.title)) continue;
    const w = toWall(b.start, tz);
    if (w.date !== date) continue;
    const len = Math.round((Date.parse(b.end) - Date.parse(b.start)) / 60000);
    return { startMin: w.minutes, endMin: w.minutes + len };
  }
  return undefined;
}

export function draftToBlock(d: Draft, tz: string, now: Date, id: string): Block {
  const start = d.startMin !== undefined ? fromWall(d.date, d.startMin, tz) : undefined;
  return {
    id,
    title: d.title,
    date: d.date,
    start: start?.toISOString(),
    end: start ? new Date(start.getTime() + d.durationMin * 60000).toISOString() : undefined,
    durationMin: d.durationMin,
    status: 'todo',
    source: 'local',
    updatedAt: now.toISOString(),
  };
}

/** True when every ambiguous draft has a chosen time. */
export const readyToCommit = (drafts: Draft[]) =>
  drafts.length > 0 && drafts.every((d) => !d.ambiguity || d.ambiguity.chosen !== undefined);
