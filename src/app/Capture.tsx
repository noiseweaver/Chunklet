import { forwardRef, useMemo, useState } from 'react';
import type { Block } from '../core/model';
import { parse, readyToCommit, type Draft } from '../core/parser';
import { formatHM } from '../core/time';

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
    <div className="border-t border-slate-200 bg-white/95 px-3 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
      {drafts.length > 0 && (
        <ul aria-label="Preview" aria-live="polite" className="mb-2 max-h-[40vh] space-y-1.5 overflow-y-auto">
          {drafts.map((d) => (
            <li key={key(d)} className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-sm dark:border-slate-700 dark:bg-slate-800/60">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  aria-label="Title"
                  value={d.title}
                  onChange={(e) => setOverride(d, { title: e.target.value })}
                  className="min-w-0 flex-1 basis-full rounded border border-transparent bg-transparent px-1 py-0.5 font-medium sm:basis-auto hover:border-slate-300 focus:border-indigo-500 focus:outline-none dark:hover:border-slate-600"
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
                  className="rounded border border-slate-300 bg-white px-1 py-0.5 tabular-nums dark:border-slate-600 dark:bg-slate-900"
                />
                <label className="flex items-center gap-1 text-slate-600 dark:text-slate-300">
                  <input
                    type="number"
                    min={5}
                    step={5}
                    aria-label="Duration in minutes"
                    value={d.durationMin}
                    onChange={(e) => setOverride(d, { durationMin: Math.max(5, Number(e.target.value) || 5) })}
                    className="w-16 rounded border border-slate-300 bg-white px-1 py-0.5 tabular-nums dark:border-slate-600 dark:bg-slate-900"
                  />
                  min
                </label>
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  {d.date !== p.date ? `${d.date} · ` : ''}
                  {d.startMin === undefined && !d.ambiguity ? 'to tray' : ''}
                </span>
              </div>
              {d.ambiguity && d.ambiguity.chosen === undefined && (
                <div role="group" aria-label="Pick a time" className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <span className="text-xs text-amber-700 dark:text-amber-400">Which time?</span>
                  {d.ambiguity.options.map((o, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setChoices((c) => ({ ...c, [d.index]: i }))}
                      className="rounded-full border border-amber-400 px-2 py-0.5 text-xs font-medium text-amber-900 hover:bg-amber-100 dark:text-amber-200 dark:hover:bg-amber-900/40"
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              )}
              {d.warnings.map((w) => (
                <p key={w} className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  {w}
                </p>
              ))}
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-end gap-2">
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
          placeholder="review PR 30m at 10, then emails 20m"
          enterKeyHint="done"
          autoComplete="off"
          className="max-h-30 min-h-11 flex-1 resize-none rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-base placeholder:text-slate-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 focus:outline-none dark:border-slate-700 dark:bg-slate-950"
        />
        <button
          type="button"
          onClick={commit}
          disabled={!ready}
          className="min-h-11 rounded-xl bg-indigo-600 px-4 font-semibold text-white hover:bg-indigo-700 disabled:bg-slate-300 disabled:text-slate-500 dark:disabled:bg-slate-800"
        >
          Add{drafts.length > 1 ? ` ${drafts.length}` : ''}
        </button>
      </div>
    </div>
  );
});
