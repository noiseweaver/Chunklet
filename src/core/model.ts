export type BlockStatus = 'todo' | 'done' | 'deferred';
export type BlockSource = 'local' | 'google' | 'caldav';

/** A unit of work. Times are UTC ISO strings; `date` is the local calendar day (YYYY-MM-DD). */
export interface Block {
  id: string;
  title: string;
  start?: string;
  end?: string;
  durationMin: number;
  status: BlockStatus;
  date: string;
  source: BlockSource;
  externalId?: string;
  etag?: string;
  calendarId?: string;
  updatedAt: string;
  deletedAt?: string;
  /** Original day of a block that rolled over unfinished. */
  rolledFrom?: string;
  /** Sort order inside the unscheduled tray. */
  order?: number;
}

export interface Settings {
  tz: string;
  dayStartMin: number;
  dayEndMin: number;
  defaultDurationMin: number;
  snapMin: number;
}

export const DEFAULT_SETTINGS: Settings = {
  tz: 'Europe/Amsterdam',
  dayStartMin: 7 * 60,
  dayEndMin: 22 * 60,
  defaultDurationMin: 25,
  snapMin: 5,
};

export const isScheduled = (b: Block): b is Block & { start: string; end: string } =>
  !!b.start && !!b.end;
