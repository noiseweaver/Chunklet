import { forwardRef, useMemo, useState } from 'react';
import type { Block } from '../core/model';
import { parse, readyToCommit, type Draft } from '../core/parser';
import { addDays, formatHM } from '../core/time';

interface Props {
  now: Date;
  tz: string;
  date: string;
  existing: Block[];
  defaultDurationMin: number;
  snapMin: number;
  onCommit: (drafts: Draft[]) => void;
}

type Override = Partial<Pick<Draft, 'title' | 'startMin' | 'durationMin'>> & { clearTime?: boolean };

const dayName = (date: string, base: string) =>
  date === addDays(base, 1)
    ? 'tomorrow'
    : new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

const toMin = (hm: string) => {
  const [h, m] = hm.split(':').map(Number);
  return h === undefined || m === undefined || Number.isNaN(h) ? undefined : h * 60 + m;
};

export const Capture = forwardRef<HTMLTextAreaElement, Props>(function Capture(p, ref) {
  const [text, setText] = useState('');
  const [choices, setChoices] = useState<Record<number, number>>({});
  const [overrides, setOverrides] = useState<Record<string, Override>>({});

  const parsed = useMemo(
    () =>
      text.trim()
        ? parse(text, { now: p.now, tz: p.tz, date: p.date, existing: p.existing, choices, defaultDurationMin: p.defaultDurationMin, snapMin: p.snapMin })
        : [],
    // `now` only matters at minute resolution for parsing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [text, choices, p.tz, p.date, p.existing, p.defaultDurationMin, p.snapMin, Math.floor(p.now.getTime() / 60000)],
  );

  const key = (d: Draft) => `${d.index}:${d.raw}`;
  const drafts: Draft[] = parsed.map((d) => {
    const o = overrides[key(d)];
    if (!o) return d;
    const startMin = o.clearTime ? undefined : (o.startMin ?? d.startMin);
    const resolved = o.startMin !== undefined || o.clearTime;
    return {
      ...d,
      title: o.title ?? d.title,
      durationMin: o.durationMin ?? d.durationMin,
      startMin,
      ambiguity: resolved && d.ambiguity ? { ...d.ambiguity, chosen: d.ambiguity.chosen ?? -1 } : d.ambiguity,
    };
  });
  const ready = readyToCommit(drafts);

  const setOverride = (d: Draft, o: Override) => setOverrides((all) => ({ ...all, [key(d)]: { ...all[key(d)], ...o } }));

  const commit = () => {
    if (!ready) return;
    p.onCommit(drafts);
    setText('');
    setChoices({});
    setOverrides({});
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      commit();
    } else if (e.key === 'Escape') {
      if (text) setText('');
      else e.currentTarget.blur();
    }
  };

  return (
    <div className="bg-ground/90 px-4 pt-2 pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur">
      {drafts.length > 0 && (
        <ul aria-label="Preview" aria-live="polite" className="mb-2 max-h-[40vh] space-y-1.5 overflow-y-auto">
          {drafts.map((d) => (
            <li key={key(d)} className="rounded-2xl bg-surface p-2.5 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  aria-label="Title"
                  value={d.title}
                  onChange={(e) => setOverride(d, { title: e.target.value })}
                  className="min-w-0 flex-1 basis-full rounded border border-transparent bg-transparent px-1 py-0.5 font-medium sm:basis-auto hover:border-line focus:border-accent-strong focus:outline-none"
                />
                <input
                  type="time"
                  step={300}
                  aria-label="Start time"
                  value={d.startMin !== undefined ? formatHM(d.startMin) : ''}
                  onChange={(e) => {
                    const m = toMin(e.target.value);
                    setOverride(d, m === undefined ? { clearTime: true, startMin: undefined } : { startMin: m, clearTime: false });
                  }}
                  className="rounded-lg border border-line bg-ground px-1.5 py-1 tabular-nums"
                />
                <label className="flex items-center gap-1 text-muted">
                  <input
                    type="number"
                    min={5}
                    step={5}
                    aria-label="Duration in minutes"
                    value={d.durationMin}
                    onChange={(e) => setOverride(d, { durationMin: Math.max(5, Number(e.target.value) || 5) })}
                    className="w-16 rounded-lg border border-line bg-ground px-1.5 py-1 text-ink tabular-nums"
                  />
                  min
                </label>
                <span className="text-xs text-muted">
                  {[d.date !== p.date ? dayName(d.date, p.date) : '', d.startMin === undefined && !d.ambiguity ? 'to tray' : '']
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </div>
              {d.ambiguity && d.ambiguity.chosen === undefined && (
                <div role="group" aria-label="Pick a time" className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <span className="text-xs font-medium text-warn-ink">Which time?</span>
                  {d.ambiguity.options.map((o, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setChoices((c) => ({ ...c, [d.index]: i }))}
                      className="min-h-8 rounded-full border border-accent-strong px-3 text-xs font-semibold hover:bg-accent-soft"
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              )}
              {d.warnings.map((w) => (
                <p key={w} className="mt-1 text-xs text-muted">
                  {w}
                </p>
              ))}
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-end gap-2 rounded-[28px] border border-line bg-surface py-1.5 pr-1.5 pl-5 focus-within:border-accent-strong">
        <label htmlFor="capture" className="sr-only">
          What do you need to do?
        </label>
        <textarea
          id="capture"
          ref={ref}
          rows={1}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            e.target.style.height = 'auto';
            e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
          }}
          onKeyDown={onKeyDown}
          placeholder="e.g. review PR 30m at 10"
          enterKeyHint="done"
          autoComplete="off"
          className="max-h-30 min-h-11 flex-1 resize-none self-center bg-transparent py-2.5 text-base text-ink placeholder:text-muted focus:outline-none focus-visible:outline-none"
        />
        <button
          type="button"
          onClick={commit}
          disabled={!ready}
          aria-label={`Add${drafts.length > 1 ? ` ${drafts.length}` : ''}`}
          className="flex h-11 min-w-11 shrink-0 items-center justify-center gap-1 rounded-full bg-accent px-3 font-semibold text-accent-ink hover:brightness-95 disabled:bg-raised disabled:text-muted"
        >
          {drafts.length > 1 && <span className="tabular-nums">{drafts.length}</span>}
          <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 19V5M5 12l7-7 7 7" />
          </svg>
        </button>
      </div>
    </div>
  );
});
