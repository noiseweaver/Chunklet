import type { Block } from '../core/model';
import { formatHM, toWall } from '../core/time';

interface Props {
  blocks: Block[];
  now: Date;
  tz: string;
  onDone: (b: Block) => void;
  onDefer: (b: Block) => void;
}

const R = 84;
const C = 2 * Math.PI * R;

/** "1:13" for an hour or more, "12:04" below an hour. */
export function shortLeft(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}`;
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

function Ring({ fraction, children, label }: { fraction: number; children: React.ReactNode; label: string }) {
  const f = Math.min(1, Math.max(0, fraction));
  return (
    <div className="relative h-40 w-40 sm:h-[196px] sm:w-[196px]">
      <svg role="img" aria-label={label} viewBox="0 0 196 196" className="h-full w-full">
        <circle cx="98" cy="98" r={R} fill="none" strokeWidth="12" className="stroke-line" />
        {f > 0 && (
          <circle
            cx="98"
            cy="98"
            r={R}
            fill="none"
            strokeWidth="12"
            strokeLinecap="round"
            strokeDasharray={`${f * C} ${C}`}
            transform="rotate(-90 98 98)"
            className="stroke-accent-strong transition-[stroke-dasharray] duration-1000 ease-linear"
          />
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5">{children}</div>
    </div>
  );
}

const minutesOf = (b: Block, tz: string) => ({ start: toWall(b.start!, tz).minutes, end: toWall(b.end!, tz).minutes });

export function Hero({ blocks, now, tz, onDone, onDefer }: Props) {
  const t = now.getTime();
  const live = blocks
    .filter((b) => !b.deletedAt && b.status === 'todo' && b.start && b.end)
    .sort((a, b) => a.start!.localeCompare(b.start!));
  const current = live.find((b) => Date.parse(b.start!) <= t && t < Date.parse(b.end!));
  const next = live.find((b) => Date.parse(b.start!) > t);

  if (current) {
    const s = Date.parse(current.start!);
    const e = Date.parse(current.end!);
    const m = minutesOf(current, tz);
    const pct = Math.round(((t - s) / (e - s)) * 100);
    return (
      <section aria-label="Current block" className="flex flex-col items-center gap-3.5 px-5 pt-2 pb-5">
        <Ring fraction={(t - s) / (e - s)} label={`${pct} percent of ${current.title} done`}>
          <span className="font-display text-[38px] sm:text-[44px] leading-none font-bold tracking-tight tabular-nums">{shortLeft(e - t)}</span>
          <span className="text-sm text-muted">left</span>
        </Ring>
        <div className="flex max-w-full flex-col items-center gap-1 text-center">
          <h2 className="max-w-full truncate font-display text-[22px] sm:text-2xl font-semibold tracking-tight">{current.title}</h2>
          <span className="text-sm text-muted tabular-nums">
            {formatHM(m.start)} to {formatHM(m.end)}
            {next ? ` · next: ${next.title} at ${formatHM(minutesOf(next, tz).start)}` : ''}
          </span>
        </div>
        <div className="flex gap-2.5">
          <button
            type="button"
            onClick={() => onDone(current)}
            className="flex h-11 items-center gap-2 rounded-full bg-accent px-5 font-semibold text-accent-ink hover:brightness-95"
          >
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12l5 5L20 7" />
            </svg>
            Done
          </button>
          <button type="button" onClick={() => onDefer(current)} className="h-11 rounded-full border border-line px-5 font-medium hover:bg-raised">
            Tomorrow
          </button>
        </div>
      </section>
    );
  }

  if (next) {
    const s = Date.parse(next.start!);
    const m = minutesOf(next, tz);
    return (
      <section aria-label="Next block" className="flex flex-col items-center gap-3.5 px-5 pt-2 pb-5">
        <Ring fraction={0} label={`${next.title} starts in ${shortLeft(s - t)}`}>
          <span className="text-sm text-muted">starts in</span>
          <span className="font-display text-[38px] sm:text-[44px] leading-none font-bold tracking-tight tabular-nums">{shortLeft(s - t)}</span>
        </Ring>
        <div className="flex max-w-full flex-col items-center gap-1 text-center">
          <span className="text-xs font-semibold tracking-widest text-muted">UP NEXT</span>
          <h2 className="max-w-full truncate font-display text-2xl font-semibold tracking-tight">{next.title}</h2>
          <span className="text-sm text-muted tabular-nums">
            {formatHM(m.start)} to {formatHM(m.end)}
          </span>
        </div>
      </section>
    );
  }

  return (
    <section aria-label="Nothing running" className="flex flex-col items-center gap-1 px-5 pt-6 pb-6 text-center">
      <h2 className="font-display text-2xl font-semibold tracking-tight">Nothing running</h2>
      <p className="text-sm text-muted">Type what's next below, or place something from the list.</p>
    </section>
  );
}
