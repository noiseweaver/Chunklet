import { useRef, useState } from 'react';
import type { Block } from '../core/model';
import { formatHM, toWall } from '../core/time';

const SWIPE_PX = 90;

interface RowProps {
  b: Block;
  time: string;
  current: boolean;
  selected: boolean;
  note?: string;
  onToggle: (b: Block) => void;
  onDefer: (b: Block) => void;
  onSelect: (id: string | null) => void;
  trailing?: React.ReactNode;
}

/** One agenda row: tap completes, swipe sideways defers, ⋯ opens actions. */
function Row({ b, time, current, selected, note, onToggle, onDefer, onSelect, trailing }: RowProps) {
  const [dx, setDx] = useState(0);
  const g = useRef<{ x0: number; y0: number; mode: 'pending' | 'swipe' | 'scroll' } | null>(null);
  const done = b.status === 'done';

  return (
    <li
      data-block-id={b.id}
      className={`relative overflow-hidden rounded-xl ${selected ? 'ring-2 ring-accent-strong' : ''} ${current ? 'bg-accent-soft' : ''}`}
    >
      {Math.abs(dx) > 12 && (
        <span aria-hidden className="absolute inset-0 flex items-center justify-end rounded-xl bg-raised px-4 text-sm font-medium text-muted">
          {Math.abs(dx) > SWIPE_PX ? 'Release: tomorrow' : 'Tomorrow →'}
        </span>
      )}
      <div
        className="relative flex min-h-11 items-center gap-3.5 rounded-xl px-3.5 touch-pan-y"
        style={{ transform: dx ? `translateX(${dx}px)` : undefined, background: dx ? 'var(--color-surface)' : undefined }}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          g.current = { x0: e.clientX, y0: e.clientY, mode: 'pending' };
        }}
        onPointerMove={(e) => {
          const cur = g.current;
          if (!cur) return;
          const ddx = e.clientX - cur.x0;
          const ddy = e.clientY - cur.y0;
          if (cur.mode === 'pending') {
            if (Math.abs(ddx) > 12 && Math.abs(ddx) > Math.abs(ddy)) {
              cur.mode = 'swipe';
              (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            } else if (Math.abs(ddy) > 8) cur.mode = 'scroll';
          }
          if (cur.mode === 'swipe') setDx(ddx);
        }}
        onPointerUp={() => {
          const cur = g.current;
          g.current = null;
          if (cur?.mode === 'swipe' && Math.abs(dx) > SWIPE_PX) onDefer(b);
          setDx(0);
        }}
        onPointerCancel={() => {
          g.current = null;
          setDx(0);
        }}
      >
        <button
          type="button"
          aria-pressed={done}
          aria-label={`${b.title}${time ? `, ${time}` : ''}, ${b.durationMin} minutes${done ? ', done' : ''}. ${done ? 'Reopen' : 'Complete'}.`}
          onClick={() => {
            if (dx === 0) onToggle(b);
          }}
          className="flex min-h-11 min-w-0 flex-1 items-center gap-3.5 text-left"
        >
          <span className={`w-11 shrink-0 text-sm tabular-nums ${done ? 'text-muted' : ''}`}>{time}</span>
          <span
            aria-hidden
            className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border-2 ${
              done ? 'border-muted bg-muted text-surface' : current ? 'border-accent-strong bg-accent-strong' : 'border-accent-strong'
            }`}
          >
            {done && (
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12l5 5L20 7" />
              </svg>
            )}
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className={`truncate text-[15px] ${done ? 'text-muted line-through' : current ? 'font-semibold' : ''}`}>{b.title}</span>
            {note && <span className="truncate text-xs text-warn-ink">{note}</span>}
          </span>
          <span className="shrink-0 text-xs text-muted tabular-nums">{b.durationMin}m</span>
        </button>
        {trailing}
        <button
          type="button"
          aria-label={`More actions for ${b.title}`}
          onClick={() => onSelect(selected ? null : b.id)}
          className="-mr-2 flex h-11 w-9 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-raised hover:text-ink"
        >
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="5" cy="12" r="1.8" />
            <circle cx="12" cy="12" r="1.8" />
            <circle cx="19" cy="12" r="1.8" />
          </svg>
        </button>
      </div>
    </li>
  );
}

interface Props {
  date: string;
  tz: string;
  now: Date;
  scheduled: Block[];
  tray: Block[];
  selectedId: string | null;
  canPlace: boolean;
  isToday: boolean;
  onSelect: (id: string | null) => void;
  onToggle: (b: Block) => void;
  onDefer: (b: Block) => void;
  onPlace: (items: Block[]) => void;
}

const shortDay = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' });

export function Agenda(p: Props) {
  const t = p.now.getTime();
  const rows = p.scheduled
    .filter((b) => b.date === p.date)
    .sort((a, b) => a.start!.localeCompare(b.start!));

  return (
    <section aria-labelledby="agenda-title" className="rounded-2xl bg-surface p-1.5">
      <h2 id="agenda-title" className="mx-3.5 mt-2 mb-1 text-xs font-semibold tracking-widest text-muted">
        {p.isToday ? 'TODAY' : 'PLANNED'}
      </h2>
      {rows.length === 0 ? (
        <p className="mx-3.5 mb-3 text-sm text-muted">Nothing with a time yet.</p>
      ) : (
        <ul className="flex flex-col">
          {rows.map((b) => (
            <Row
              key={b.id}
              b={b}
              time={formatHM(toWall(b.start!, p.tz).minutes)}
              current={b.status === 'todo' && Date.parse(b.start!) <= t && t < Date.parse(b.end!)}
              selected={p.selectedId === b.id}
              onToggle={p.onToggle}
              onDefer={p.onDefer}
              onSelect={p.onSelect}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

type TrayProps = Pick<Props, 'tray' | 'selectedId' | 'canPlace' | 'onSelect' | 'onToggle' | 'onDefer' | 'onPlace'>;

export function TrayList(p: TrayProps) {
  const open = p.tray.filter((b) => b.status !== 'done');
  return (
    <section aria-labelledby="tray-heading" className="rounded-2xl bg-surface p-1.5">
      <div className="mx-3.5 mt-1 flex min-h-9 items-center justify-between gap-2">
        <h2 id="tray-heading" className="text-xs font-semibold tracking-widest text-muted">
          UNSCHEDULED · {open.length}
        </h2>
        {p.canPlace && open.length > 0 && (
          <button
            type="button"
            onClick={() => p.onPlace(open)}
            className="h-8 rounded-full bg-raised px-3 text-sm font-semibold text-accent-strong hover:brightness-95"
          >
            Auto-place
          </button>
        )}
      </div>
      {p.tray.length === 0 ? (
        <p className="mx-3.5 mb-3 text-sm text-muted">Things without a time land here.</p>
      ) : (
        <ul className="flex flex-col">
          {p.tray.map((b) => (
            <Row
              key={b.id}
              b={b}
              time=""
              current={false}
              selected={p.selectedId === b.id}
              note={b.rolledFrom ? `from ${shortDay(b.rolledFrom)}` : b.status === 'deferred' ? 'deferred' : undefined}
              onToggle={p.onToggle}
              onDefer={p.onDefer}
              onSelect={p.onSelect}
              trailing={
                p.canPlace && b.status !== 'done' ? (
                  <button
                    type="button"
                    onClick={() => p.onPlace([b])}
                    className="h-8 shrink-0 rounded-full px-2.5 text-xs font-semibold text-accent-strong hover:bg-raised"
                  >
                    Place
                  </button>
                ) : undefined
              }
            />
          ))}
        </ul>
      )}
    </section>
  );
}
